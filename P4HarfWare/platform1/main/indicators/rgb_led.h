/*
 * rgb_led.h — RGB 状态指示灯
 *
 * 三路 GPIO 恒亮/灭混色(无 PWM 调光)，按 cabinet 状态机 5 态显示颜色。
 * 颜色映射与共阳/共阴在 config.h 配置。
 */
#ifndef RGB_LED_H
#define RGB_LED_H

#include "esp_err.h"
#include "bus/app_events.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief 初始化 RGB 三路 GPIO 输出，初始熄灭。
 */
esp_err_t rgb_init(void);

/**
 * @brief 按 cabinet 状态查表点亮对应颜色。
 */
void rgb_set_state(cabinet_state_t s);

#ifdef __cplusplus
}
#endif

#endif // RGB_LED_H