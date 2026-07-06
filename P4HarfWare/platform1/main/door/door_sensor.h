/*
 * door_sensor.h — 门磁传感器检测模块
 *
 * 低电平=门合上(干接点闭合)，高电平=门分开(浮空被上拉)。
 * 状态变化时 post APP_EVT_DOOR_OPENED / APP_EVT_DOOR_CLOSED 到
 * 默认事件总线(APP_BUS)，由 cabinet 状态机驱动拍照/上传/上报流程。
 *
 * 引脚与防抖参数见 config.h 的 Door magnet sensor 段。
 */
#ifndef DOOR_SENSOR_H
#define DOOR_SENSOR_H

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief 初始化门磁传感器：配置 GPIO、安装 ISR、启动后台确认任务。
 * @return ESP_OK 成功；失败见 esp_err_to_name。
 */
esp_err_t door_sensor_init(void);

#ifdef __cplusplus
}
#endif

#endif // DOOR_SENSOR_H