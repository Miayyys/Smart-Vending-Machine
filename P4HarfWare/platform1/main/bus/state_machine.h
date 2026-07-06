/*
 * state_machine.h — Cabinet state machine + event bus init
 *
 * Call cabinet_init() once at startup to create the event loop,
 * subscribe to APP_BUS events, and drive the business flow.
 */
#ifndef STATE_MACHINE_H
#define STATE_MACHINE_H

#include "bus/app_events.h"
#include <stddef.h>
#include "network/wifi_mqtt.h"
#include "camera/camera_pipeline.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialise the event bus and state machine with MQTT + camera.
 * Must be called after WifiMqtt and CameraPipeline are constructed.
 */
esp_err_t cabinet_init(WifiMqtt *mqtt, CameraPipeline *cam);

/**
 * @brief Get the current cabinet state.
 */
cabinet_state_t cabinet_get_state(void);

/**
 * @brief Human-readable state name.
 */
const char *cabinet_state_str(cabinet_state_t s);

/**
 * @brief Manually trigger a full photo→upload→report cycle.
 * Used by the console "photo" command.  Does NOT change cabinet state.
 * @return 0 on success, -1 on failure.
 */
int cabinet_photo_cycle(const char *door_action);

/**
 * @brief Event handler to be registered as wifi_mqtt callback.
 * Posts MQTT cmds as APP_BUS events (APP_EVT_CMD_*).
 */
void cabinet_on_mqtt_msg(const char *topic, const char *data, int data_len);

#ifdef __cplusplus
}
#endif

#endif // STATE_MACHINE_H
