/*
 * main.cpp — Orchestrator: constructs all global objects in order.
 *
 * Init order:
 *   1. NVS flash
 *   2. WiFi + MQTT (blocks until connected)
 *   3. Camera pipeline
 *   4. Cabinet state machine (passes MQTT + camera singletons)
 *   5. Console REPL
 */
#include "config.h"
#include "network/wifi_mqtt.h"
#include "camera/camera_pipeline.h"
#include "bus/state_machine.h"
#include "repl/console.h"
#include "yolo/yolo_detect.h"
#include "door/door_sensor.h"
#include "esp_log.h"
#include "nvs_flash.h"

static const char *TAG = "main";

// Global singletons (constructed in order in app_main)
WifiMqtt       *g_mqtt   = nullptr;
CameraPipeline *g_camera = nullptr;

extern "C" void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());

    ESP_LOGI(TAG, "=== Smart Vending Machine P4HarfWare ===");

    // 1. WiFi + MQTT
    g_mqtt = new WifiMqtt(cabinet_on_mqtt_msg);
    if (!*g_mqtt) ESP_LOGE(TAG, "MQTT not connected (WiFi failed?)");

    // 2. Camera
    g_camera = new CameraPipeline();
    if (g_camera->init() != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed — photo/upload won't work");
        delete g_camera;
        g_camera = nullptr;
    }

    // 3. Cabinet state machine (takes ownership of event dispatch)
    ESP_ERROR_CHECK(cabinet_init(g_mqtt, g_camera));

    // 4. YOLO init
    if constexpr (YOLO_ENABLED) {
        if (yolo_init() == ESP_OK)
            ESP_LOGI(TAG, "YOLO ready");
        else
            ESP_LOGW(TAG, "YOLO not loaded (model partition missing?)");
    }

    // 4b. Door magnet sensor (drives APP_EVT_DOOR_OPENED/CLOSED on the bus)
    if constexpr (DOOR_GPIO_ENABLED) {
        if (door_sensor_init() == ESP_OK)
            ESP_LOGI(TAG, "Door sensor ready on GPIO%d", DOOR_MAGNET_GPIO);
        else
            ESP_LOGE(TAG, "Door sensor init failed");
    }

    // 5. Console
    console_init();

    // Idle — everything else is event-driven
}
