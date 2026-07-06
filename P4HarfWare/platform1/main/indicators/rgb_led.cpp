/*
 * rgb_led.cpp — RGB 状态指示灯
 *
 * 三路 GPIO 恒亮/灭，按 cabinet 状态查 RGB_STATE_COLORS 表点亮。
 * 共阴: 1=亮(高电平)；共阳: 0=亮(低电平)。
 */
#include "indicators/rgb_led.h"
#include "config.h"

#include "esp_log.h"
#include "driver/gpio.h"

static const char *TAG = "rgb";

static inline void set_channel(gpio_num_t pin, int on)
{
    // 共阴: on=高电平；共阳: on=低电平
    int level = RGB_COMMON_ANODE ? (!on) : on;
    gpio_set_level(pin, level);
}

esp_err_t rgb_init(void)
{
    gpio_num_t pins[3] = { RGB_R_GPIO, RGB_G_GPIO, RGB_B_GPIO };
    for (int i = 0; i < 3; i++) {
        gpio_config_t io = {};
        io.pin_bit_mask  = (1ULL << pins[i]);
        io.mode          = GPIO_MODE_OUTPUT;
        io.pull_up_en    = GPIO_PULLUP_DISABLE;
        io.pull_down_en  = GPIO_PULLDOWN_DISABLE;
        io.intr_type     = GPIO_INTR_DISABLE;
        esp_err_t ret = gpio_config(&io);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "gpio_config pin=%d failed: %s", pins[i], esp_err_to_name(ret));
            return ret;
        }
        gpio_set_level(pins[i], RGB_COMMON_ANODE ? 1 : 0);  // 初始熄灭
    }
    ESP_LOGI(TAG, "RGB on R=%d G=%d B=%d (%s)",
             RGB_R_GPIO, RGB_G_GPIO, RGB_B_GPIO,
             RGB_COMMON_ANODE ? "common anode" : "common cathode");
    return ESP_OK;
}

void rgb_set_state(cabinet_state_t s)
{
    int idx = (int)s;
    if (idx < 0 || idx >= (int)(sizeof(RGB_STATE_COLORS) / sizeof(RGB_STATE_COLORS[0]))) return;
    const int *c = RGB_STATE_COLORS[idx];
    set_channel(RGB_R_GPIO, c[0]);
    set_channel(RGB_G_GPIO, c[1]);
    set_channel(RGB_B_GPIO, c[2]);
}