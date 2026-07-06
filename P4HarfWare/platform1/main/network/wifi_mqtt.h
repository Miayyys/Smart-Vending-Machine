#ifndef WIFI_MQTT_H
#define WIFI_MQTT_H

#include <cstdint>
#include <functional>
#include "esp_err.h"
#include "config.h"

// Pre-built topic strings
constexpr const char *MQTT_TOPIC_EVENT_DETECT     = MQTT_TOPIC_PREFIX "/event/detect";
constexpr const char *MQTT_TOPIC_EVENT_ANOMALY    = MQTT_TOPIC_PREFIX "/event/anomaly";
constexpr const char *MQTT_TOPIC_OTA_PROGRESS     = MQTT_TOPIC_PREFIX "/event/ota_progress";
constexpr const char *MQTT_TOPIC_TELEMETRY_WEIGHT = MQTT_TOPIC_PREFIX "/telemetry/weight";

/** Callback for incoming MQTT messages (topic, payload, len). */
using MqttCallback = std::function<void(const char *topic, const char *data, int len)>;

/**
 * @brief RAII WiFi STA + MQTT client.
 *
 * On construction blocks until WiFi is associated, then starts the MQTT
 * connection.  Destruction tears everything down.
 */
class WifiMqtt {
public:
    explicit WifiMqtt(MqttCallback on_message = nullptr);
    ~WifiMqtt();

    int publish(const char *topic, const char *json, int qos = 1);
    esp_err_t setWifi(const char *ssid, const char *password);
    esp_err_t getSsid(char *buf, size_t len) const;

    explicit operator bool() const;
};

#endif // WIFI_MQTT_H
