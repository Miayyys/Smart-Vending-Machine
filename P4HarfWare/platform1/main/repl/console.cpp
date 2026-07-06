/*
 * console.c — UART console commands for the vending machine.
 *
 * Extracted from the old monolithic main.c to keep modules clean.
 */
#include "repl/console.h"
#include "bus/state_machine.h"
#include "bus/app_events.h"
#include "config.h"
#include "camera/camera_pipeline.h"
#include "network/wifi_mqtt.h"
#if YOLO_ENABLED
#include "yolo/yolo_detect.h"
#include "dl_image_jpeg.hpp"
#endif
#include "indicators/servo.h"
#include "esp_console.h"
#include "esp_event.h"
#include "driver/i2c_master.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "console";

// Global singletons from main.cpp
extern WifiMqtt       *g_mqtt;
extern CameraPipeline *g_camera;

/* ── Commands ───────────────────────────────────────── */

static int cmd_photo(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("Capturing & uploading...\n");
    int rc = cabinet_photo_cycle("OPEN");
    printf(rc == 0 ? "OK\n" : "FAILED\n");
    return 0;
}

static int cmd_info(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("Device: %s  Floor: %d\n", DEVICE_ID, DEVICE_FLOOR);
    printf("Camera: %" PRIu32 "x%" PRIu32 "\n",
           g_camera ? g_camera->width() : 0, g_camera ? g_camera->height() : 0);
    printf("Server: %s:%d\n", SERVER_HOST, SERVER_PORT);
    printf("MQTT:   %s (%s)\n", MQTT_BROKER_URI, MQTT_USERNAME);
    printf("Token:  %s\n", SNAP_TOKEN);
    printf("State:  %s\n", cabinet_state_str(cabinet_get_state()));
    printf("YOLO:   %s\n", YOLO_ENABLED ? "enabled" : "disabled");
    return 0;
}

static int cmd_scan_i2c(int argc, char **argv)
{
    (void)argc; (void)argv;
    i2c_master_bus_config_t bus_cfg;
    memset(&bus_cfg, 0, sizeof(bus_cfg));
    bus_cfg.i2c_port = I2C_NUM_1;
    bus_cfg.sda_io_num = CAM_I2C_SDA_PIN;
    bus_cfg.scl_io_num = CAM_I2C_SCL_PIN;
    bus_cfg.clk_source = I2C_CLK_SRC_DEFAULT;
    bus_cfg.glitch_ignore_cnt = 7;
    bus_cfg.flags.enable_internal_pullup = true;
    i2c_master_bus_handle_t bus;
    if (i2c_new_master_bus(&bus_cfg, &bus) != ESP_OK) {
        printf("I2C bus init failed\n");
        return 1;
    }
    printf("Scanning I2C...\n");
    int found = 0;
    for (uint8_t addr = 0x01; addr < 0x78; addr++) {
        if (i2c_master_probe(bus, addr, 5) == ESP_OK) {
            printf("  0x%02X\n", addr);
            found++;
        }
    }
    printf("%d device(s)\n", found);
    i2c_del_master_bus(bus);
    return 0;
}

#if YOLO_ENABLED
/* Embedded test.jpg symbols (defined by EMBED_TXTFILES in CMakeLists) */
extern const uint8_t test_jpg_start[] asm("_binary_test_jpg_start");
extern const uint8_t test_jpg_end[]   asm("_binary_test_jpg_end");

static int cmd_yolo_test(int argc, char **argv)
{
    (void)argc; (void)argv;
    if (!yolo_is_ready()) {
        printf("YOLO not loaded\n");
        return 1;
    }
    printf("Decoding embedded test.jpg (%d bytes)...\n",
           int(test_jpg_end - test_jpg_start));

    dl::image::jpeg_img_t jpeg{
        .data = (void *)test_jpg_start,
        .data_len = size_t(test_jpg_end - test_jpg_start),
    };
    auto img = dl::image::sw_decode_jpeg(jpeg, dl::image::DL_IMAGE_PIX_TYPE_RGB565LE);
    if (!img.data) { printf("Decode failed\n"); return 1; }

    printf("Decoded %dx%d, running YOLO...\n", img.width, img.height);
    yolo_result_t yr{};
    auto ret = yolo_detect((uint8_t *)img.data, img.width, img.height, &yr);
    heap_caps_free(img.data);

    if (ret == ESP_OK) {
        printf("YOLO: %d object(s)\n", yr.count);
        for (int i = 0; i < yr.count; ++i) {
            auto &d = yr.items[i];
            printf("  [%d] label=%d score=%.2f box=(%d,%d %dx%d)\n",
                   i, d.label_id, double(d.score),
                   d.x, d.y, d.w, d.h);
        }
        free(yr.items);
    } else {
        printf("YOLO inference failed\n");
    }

    return 0;
}
#endif

static int cmd_state(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("Cabinet state: %s\n", cabinet_state_str(cabinet_get_state()));
    return 0;
}

static int cmd_door_open(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("Posting DOOR_OPENED event...\n");
    esp_event_post(APP_BUS, APP_EVT_DOOR_OPENED, NULL, 0, portMAX_DELAY);
    printf("OK\n");
    return 0;
}

static int cmd_door_close(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("Posting DOOR_CLOSED event...\n");
    esp_event_post(APP_BUS, APP_EVT_DOOR_CLOSED, NULL, 0, portMAX_DELAY);
    printf("OK\n");
    return 0;
}

static int cmd_wifi(int argc, char **argv)
{
    if (argc < 2) {
        char cur[33] = {0};
        if (g_mqtt) g_mqtt->getSsid(cur, sizeof(cur));
        printf("Usage: wifi <SSID> <PASSWORD>\n");
        printf("Current SSID: %s\n", cur);
        printf("Saved to NVS; reconnects automatically. Persists across reboots.\n");
        return 0;
    }
    const char *ssid = argv[1];
    const char *pass = (argc > 2) ? argv[2] : "";
    if (strlen(ssid) == 0 || strlen(ssid) > 32) {
        printf("Invalid SSID (1-32 chars)\n");
        return 1;
    }
    if (!g_mqtt) { printf("MQTT not available\n"); return 1; }
    esp_err_t ret = g_mqtt->setWifi(ssid, pass);
    if (ret == ESP_OK) {
        printf("WiFi set to '%s', reconnecting...\n", ssid);
    } else {
        printf("Failed: %s\n", esp_err_to_name(ret));
    }
    return (ret == ESP_OK) ? 0 : 1;
}

static int cmd_servo(int argc, char **argv)
{
    if (argc < 2) {
        printf("Usage: servo <angle 0-180>\n");
        return 1;
    }
    int angle = atoi(argv[1]);
    if (angle < 0 || angle > 180) {
        printf("Angle must be 0-180\n");
        return 1;
    }
    servo_set_angle(angle);
    printf("Servo → %d°\n", angle);
    return 0;
}

/* ── Init ──────────────────────────────────────────── */

void console_init(void)
{
    esp_console_repl_config_t repl_cfg = ESP_CONSOLE_REPL_CONFIG_DEFAULT();
    repl_cfg.prompt = "p4> ";
    repl_cfg.max_cmdline_length = 256;

    esp_console_dev_uart_config_t uart_cfg = ESP_CONSOLE_DEV_UART_CONFIG_DEFAULT();
    esp_console_repl_t *repl = NULL;
    ESP_ERROR_CHECK(esp_console_new_repl_uart(&uart_cfg, &repl_cfg, &repl));

    esp_console_cmd_t cmds[] = {
        {.command = "photo",     .help = "Capture + upload + report",       .func = cmd_photo},
        {.command = "info",      .help = "Device status",                   .func = cmd_info},
        {.command = "scan",      .help = "Scan I2C bus",                    .func = cmd_scan_i2c},
        {.command = "state",     .help = "Show cabinet state",              .func = cmd_state},
        {.command = "door_open", .help = "Simulate door open",              .func = cmd_door_open},
        {.command = "door_close",.help = "Simulate door close",             .func = cmd_door_close},
        {.command = "wifi",      .help = "Set WiFi: wifi <SSID> [PASSWORD]",.func = cmd_wifi},
        {.command = "servo",     .help = "Set servo angle: servo <0-180>", .func = cmd_servo},
    };
    for (size_t i = 0; i < sizeof(cmds)/sizeof(cmds[0]); i++)
        ESP_ERROR_CHECK(esp_console_cmd_register(&cmds[i]));

#if YOLO_ENABLED
    esp_console_cmd_t yolo_cmd = {
        .command = "yolo_test",
        .help = "Run YOLO on embedded test.jpg",
        .func = cmd_yolo_test,
    };
    ESP_ERROR_CHECK(esp_console_cmd_register(&yolo_cmd));
#endif

    esp_console_register_help_command();
    ESP_ERROR_CHECK(esp_console_start_repl(repl));
}
