/*
 * servo.cpp — SG90 舵机 PWM 控制
 *
 * 50Hz(20ms 周期)，脉宽 500μs=0°、2500μs=180°（此范围与 mimiclaw 项目一致）。
 * LEDC 14-bit 分辨率：16384 duty = 20ms，故 500μs→410、2500μs→2048。
 * 角度→duty: 410 + angle/180 * 1638。
 *
 * 角度与开门/关门映射由 config.h 的 SERVO_ANGLE_OPEN / CLOSED 定义。
 */
#include "indicators/servo.h"
#include "config.h"

#include "esp_log.h"
#include "driver/ledc.h"

static const char *TAG = "servo";

// 14-bit 分辨率下，500μs=0°、2500μs=180°
#define SERVO_DUTY_RESOLUTION  LEDC_TIMER_14_BIT
#define SERVO_DUTY_MIN         410    // 500μs  → 0°
#define SERVO_DUTY_MAX         2048   // 2500μs → 180°

esp_err_t servo_init(void)
{
    ledc_timer_t timer   = (ledc_timer_t)SERVO_LEDC_TIMER;
    ledc_channel_t chan  = (ledc_channel_t)SERVO_LEDC_CHANNEL;

    ledc_timer_config_t tmr = {};
    tmr.speed_mode        = LEDC_LOW_SPEED_MODE;
    tmr.duty_resolution   = SERVO_DUTY_RESOLUTION;
    tmr.timer_num         = timer;
    tmr.freq_hz           = SERVO_FREQ_HZ;
    tmr.clk_cfg           = LEDC_AUTO_CLK;
    esp_err_t ret = ledc_timer_config(&tmr);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ledc_timer_config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ledc_channel_config_t ch = {};
    ch.gpio_num   = SERVO_GPIO;
    ch.speed_mode = LEDC_LOW_SPEED_MODE;
    ch.channel    = chan;
    ch.timer_sel  = timer;
    ch.duty       = SERVO_DUTY_MIN + (SERVO_ANGLE_CLOSED * (SERVO_DUTY_MAX - SERVO_DUTY_MIN)) / 180;
    ESP_LOGI(TAG, "servo on GPIO%d @ %dHz (timer=%d ch=%d) closed=%d°",
             SERVO_GPIO, SERVO_FREQ_HZ, SERVO_LEDC_TIMER, SERVO_LEDC_CHANNEL, SERVO_ANGLE_CLOSED);
    return ledc_channel_config(&ch);
}

void servo_set_angle(int angle)
{
    if (angle < 0)   angle = 0;
    if (angle > 180) angle = 180;
    uint32_t duty = SERVO_DUTY_MIN + (uint32_t)(angle * (SERVO_DUTY_MAX - SERVO_DUTY_MIN)) / 180;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)SERVO_LEDC_CHANNEL, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, (ledc_channel_t)SERVO_LEDC_CHANNEL);
}

void servo_open(void)   { servo_set_angle(SERVO_ANGLE_OPEN);   }
void servo_close(void)  { servo_set_angle(SERVO_ANGLE_CLOSED); }