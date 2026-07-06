/*
 * servo.h — SG90 舵机控制(PWM)
 *
 * GPIO 输出 50Hz PWM，脉宽 1ms(0°)/2ms(90°) 驱动 SG90。
 * 角度与开门/关门映射在 config.h 配置。
 */
#ifndef SERVO_H
#define SERVO_H

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief 初始化舵机 LEDC PWM，并移到关门角度。
 */
esp_err_t servo_init(void);

/**
 * @brief 设置舵机角度(0..180°)。
 */
void servo_set_angle(int angle);

/**
 * @brief 转到开门角度(SERVO_ANGLE_OPEN)。
 */
void servo_open(void);

/**
 * @brief 转到关门角度(SERVO_ANGLE_CLOSED)。
 */
void servo_close(void);

#ifdef __cplusplus
}
#endif

#endif // SERVO_H