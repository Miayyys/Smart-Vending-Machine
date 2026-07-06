/*
 * door_sensor.cpp — 门磁传感器检测(提炼自独立测试程序 main.c)。
 *
 * 流程：GPIO 任意边沿中断 → ISR 防抖过滤 → 发事件到队列 →
 *       后台任务排空旧事件 → 等电平稳定 → 多数表决确认 →
 *       状态确实变化时 post APP_EVT_DOOR_OPENED/CLOSED 到 APP_BUS。
 *
 * ISR 极简，重活留给任务；多数表决+阈值避免浮空噪声误判"合上"。
 */
#include "door/door_sensor.h"
#include "config.h"
#include "bus/app_events.h"

#include "esp_log.h"
#include "esp_event.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"

static const char *TAG = "DOOR_SENSOR";

// 事件类型(队列内)
typedef enum {
    DOOR_EVENT_CLOSED,
    DOOR_EVENT_OPENED,
} door_event_t;

// 当前已确认并上报的状态
static bool     door_is_closed      = true;
static uint32_t last_interrupt_time = 0;

// ISR → 任务 的消息队列
static QueueHandle_t gpio_event_queue = NULL;

// GPIO 中断处理函数 — 只做最小工作
static void IRAM_ATTR door_gpio_isr_handler(void *arg)
{
    (void)arg;
    uint32_t now = xTaskGetTickCountFromISR() * portTICK_PERIOD_MS;

    // 防抖：中断间隔太近则忽略
    if (now - last_interrupt_time < DEBOUNCE_TIME_MS) return;
    last_interrupt_time = now;

    int level = gpio_get_level(DOOR_MAGNET_GPIO);
    door_event_t ev = (level == 0) ? DOOR_EVENT_CLOSED : DOOR_EVENT_OPENED;
    xQueueSendFromISR(gpio_event_queue, &ev, NULL);
}

// 稳定电平确认：多次采样按阈值判定。
// 合上=低电平占比≥CLOSED_LOW_RATIO；否则视为分开。
// 浮空噪声(~50%低电平)不会误判为合上。
static int read_stable_level(void)
{
    int low_count = 0;
    for (int i = 0; i < CONFIRM_SAMPLES; i++) {
        if (gpio_get_level(DOOR_MAGNET_GPIO) == 0) low_count++;
        vTaskDelay(pdMS_TO_TICKS(CONFIRM_SAMPLE_MS));
    }
    float low_ratio = (float)low_count / (float)CONFIRM_SAMPLES;
    return (low_ratio >= CLOSED_LOW_RATIO) ? 0 : 1;
}

// 处理门磁事件的任务
static void door_event_task(void *arg)
{
    (void)arg;
    door_event_t ev;
    while (true) {
        if (xQueueReceive(gpio_event_queue, &ev, portMAX_DELAY) != pdTRUE) continue;

        // 排空队列中积压的旧事件，只处理最新的一次
        while (xQueueReceive(gpio_event_queue, &ev, 0) == pdTRUE) { /* drop */ }

        // 等待电平稳定后再确认
        vTaskDelay(pdMS_TO_TICKS(CONFIRM_DELAY_MS));

        int confirmed = read_stable_level();
        bool now_closed = (confirmed == 0);

        // 前后状态一致则完全静默
        if (now_closed == door_is_closed) continue;
        door_is_closed = now_closed;

        if (door_is_closed) {
            ESP_LOGI(TAG, "=== 门已合上 ===");
            esp_event_post(APP_BUS, APP_EVT_DOOR_CLOSED, NULL, 0, 0);
        } else {
            ESP_LOGI(TAG, "=== 门已分开 ===");
            esp_event_post(APP_BUS, APP_EVT_DOOR_OPENED, NULL, 0, 0);
        }
    }
}

esp_err_t door_sensor_init(void)
{
    ESP_LOGI(TAG, "门磁传感器初始化: GPIO%d (上拉=%d)", DOOR_MAGNET_GPIO, DOOR_MAGNET_PULLUP ? 1 : 0);

    gpio_event_queue = xQueueCreate(10, sizeof(door_event_t));
    if (gpio_event_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create event queue");
        return ESP_ERR_NO_MEM;
    }

    if (xTaskCreate(door_event_task, "door_evt", 3072, NULL, tskIDLE_PRIORITY + 2, NULL) != pdPASS) {
        ESP_LOGE(TAG, "Failed to create door task");
        return ESP_ERR_NO_MEM;
    }

    gpio_config_t io_conf = {};
    io_conf.pin_bit_mask  = (1ULL << DOOR_MAGNET_GPIO);
    io_conf.mode          = GPIO_MODE_INPUT;
    io_conf.pull_up_en   = DOOR_MAGNET_PULLUP ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE;
    io_conf.pull_down_en = GPIO_PULLDOWN_DISABLE;
    io_conf.intr_type    = GPIO_INTR_ANYEDGE;

    esp_err_t ret = gpio_config(&io_conf);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "gpio_config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    // 安装中断服务(可能已被其它模块安装，重复返回 INVALID_STATE 是安全的)
    ret = gpio_install_isr_service(0);
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG, "gpio_install_isr_service failed: %s", esp_err_to_name(ret));
        return ret;
    }
    ret = gpio_isr_handler_add(DOOR_MAGNET_GPIO, door_gpio_isr_handler, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "gpio_isr_handler_add failed: %s", esp_err_to_name(ret));
        return ret;
    }

    // 初始状态(不 post 事件，仅初始化内部状态)
    door_is_closed = (gpio_get_level(DOOR_MAGNET_GPIO) == 0);
    ESP_LOGI(TAG, "初始状态: %s", door_is_closed ? "门已合上" : "门已分开");
    return ESP_OK;
}