#include "network/wifi_mqtt.h"
#include "config.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "mqtt_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <cstring>

static const char *TAG = "wifi_mqtt";

// ── NVS keys ───────────────────────────────────────────────────
#define NVS_NS    "wifi_cfg"
#define NVS_SSID  "ssid"
#define NVS_PASS  "passwd"

// ── internal state (hidden from header) ────────────────────────
namespace {
    EventGroupHandle_t     s_evt    = nullptr;
    esp_mqtt_client_handle_t s_mqtt = nullptr;
    constexpr EventBits_t  CONNECTED  = BIT0;
    constexpr EventBits_t  FAIL       = BIT1;
    int                    s_retry    = 0;
    char                   s_ssid[33] = {};
    MqttCallback           s_cb;
}  // namespace

// ── WiFi event handler (free function; the IDF C API needs it) ─
static void wifi_event(void *, esp_event_base_t, int32_t id, void *data)
{
    if (id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            ++s_retry;
        } else {
            xEventGroupSetBits(s_evt, FAIL);
        }
    } else if (id == IP_EVENT_STA_GOT_IP) {
        auto *ip = static_cast<ip_event_got_ip_t *>(data);
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&ip->ip_info.ip));
        s_retry = 0;
        xEventGroupSetBits(s_evt, CONNECTED);
    }
}

// ── MQTT event handler (free function) ─────────────────────────
static void mqtt_event(void *, esp_event_base_t, int32_t id, void *data)
{
    auto *ev = static_cast<esp_mqtt_event_handle_t>(data);

    switch (esp_mqtt_event_id_t(id)) {
    case MQTT_EVENT_CONNECTED: {
        ESP_LOGI(TAG, "MQTT connected");
        char sub[64];
        snprintf(sub, sizeof(sub), "retail/%s/cmd/#", DEVICE_ID);
        esp_mqtt_client_subscribe(ev->client, sub, 1);
        break;
    }
    case MQTT_EVENT_DATA:
        if (s_cb) {
            auto *payload = static_cast<char *>(malloc(ev->data_len + 1));
            if (payload) {
                memcpy(payload, ev->data, ev->data_len);
                payload[ev->data_len] = 0;
                s_cb(ev->topic, payload, ev->data_len);
                free(payload);
            }
        }
        break;
    case MQTT_EVENT_ERROR:
        ESP_LOGW(TAG, "MQTT error");
        break;
    default:
        break;
    }
}

// ── NVS helpers ────────────────────────────────────────────────
static void load_creds(char *ssid, size_t ssid_sz, char *pass, size_t pass_sz)
{
    ssid[0] = pass[0] = '\0';
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        size_t need = ssid_sz;
        if (nvs_get_str(h, NVS_SSID, ssid, &need) == ESP_OK) {
            need = pass_sz;
            nvs_get_str(h, NVS_PASS, pass, &need);
        }
        nvs_close(h);
    }
    if (ssid[0] == '\0') {
        strlcpy(ssid, WIFI_SSID, ssid_sz);
        strlcpy(pass, WIFI_PASSWORD, pass_sz);
    }
}

static void save_creds(const char *ssid, const char *pass)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_set_str(h, NVS_SSID, ssid);
        nvs_set_str(h, NVS_PASS, pass ? pass : "");
        nvs_commit(h);
        nvs_close(h);
    }
}

// ── WifiMqtt implementation ────────────────────────────────────

WifiMqtt::WifiMqtt(MqttCallback cb)
{
    s_cb = std::move(cb);

    // ------ WiFi STA ------
    s_evt = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event, nullptr, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event, nullptr, nullptr));

    char ssid[33], pass[64];
    load_creds(ssid, sizeof(ssid), pass, sizeof(pass));
    strlcpy(s_ssid, ssid, sizeof(s_ssid));

    wifi_config_t wcfg{};
    memcpy(wcfg.sta.ssid, ssid, sizeof(wcfg.sta.ssid));
    memcpy(wcfg.sta.password, pass, sizeof(wcfg.sta.password));
    wcfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wcfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "WiFi connecting… %s", ssid);
    auto bits = xEventGroupWaitBits(s_evt, CONNECTED | FAIL,
                                     pdFALSE, pdFALSE, portMAX_DELAY);
    if (bits & FAIL) {
        ESP_LOGE(TAG, "WiFi failed after %d retries", WIFI_MAX_RETRY);
        return;    // mqtt_ stays null — operator bool() returns false
    }

    // ------ MQTT ------
    esp_mqtt_client_config_t mq{};
    mq.broker.address.uri                    = MQTT_BROKER_URI;
    mq.credentials.username                 = MQTT_USERNAME;
    mq.credentials.authentication.password  = MQTT_PASSWORD;
    mq.session.keepalive                    = 60;
    mq.network.disable_auto_reconnect        = false;
    mq.network.reconnect_timeout_ms          = 5000;

    s_mqtt = esp_mqtt_client_init(&mq);
    if (!s_mqtt) { ESP_LOGE(TAG, "mqtt init failed"); return; }

    esp_mqtt_client_register_event(s_mqtt, esp_mqtt_event_id_t(ESP_EVENT_ANY_ID),
                                   &mqtt_event, nullptr);
    esp_mqtt_client_start(s_mqtt);
}

WifiMqtt::~WifiMqtt()
{
    if (s_mqtt) {
        esp_mqtt_client_stop(s_mqtt);
        esp_mqtt_client_destroy(s_mqtt);
        s_mqtt = nullptr;
    }
}

int WifiMqtt::publish(const char *topic, const char *json, int qos)
{
    if (!s_mqtt) return -1;
    return esp_mqtt_client_publish(s_mqtt, topic, json, 0, qos, 0);
}

WifiMqtt::operator bool() const { return s_mqtt != nullptr; }

esp_err_t WifiMqtt::setWifi(const char *ssid, const char *password)
{
    if (!ssid || ssid[0] == 0 || strlen(ssid) > 32) return ESP_ERR_INVALID_ARG;
    save_creds(ssid, password ? password : "");
    strlcpy(s_ssid, ssid, sizeof(s_ssid));

    wifi_config_t wcfg{};
    memcpy(wcfg.sta.ssid, ssid, sizeof(wcfg.sta.ssid));
    memcpy(wcfg.sta.password, password ? password : "", sizeof(wcfg.sta.password));
    wcfg.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    s_retry = 0;
    if (s_evt) xEventGroupClearBits(s_evt, CONNECTED | FAIL);
    esp_wifi_disconnect();
    esp_wifi_set_config(WIFI_IF_STA, &wcfg);
    esp_wifi_connect();

    ESP_LOGI(TAG, "WiFi → %s, reconnecting…", ssid);
    return ESP_OK;
}

esp_err_t WifiMqtt::getSsid(char *buf, size_t len) const
{
    if (!buf || !len) return ESP_ERR_INVALID_ARG;
    strlcpy(buf, s_ssid, len);
    return ESP_OK;
}
