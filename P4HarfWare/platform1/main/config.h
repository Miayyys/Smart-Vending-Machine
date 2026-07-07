#ifndef CONFIG_H
#define CONFIG_H

#include "driver/gpio.h"
#include <cstdint>

// ── WiFi ────────────────────────────────────────
// 部署时修改为实际 WiFi 的 SSID 和密码
constexpr const char *WIFI_SSID = "your-wifi-ssid";
constexpr const char *WIFI_PASSWORD = "your-wifi-password";
constexpr int WIFI_MAX_RETRY = 5;

// ── Cloud platform ──────────────────────────────
// 部署时修改为实际服务器 IP 或域名
constexpr const char *SERVER_HOST = "your-server-ip";
constexpr int SERVER_PORT = 443;

constexpr const char *MQTT_BROKER_URI = "mqtt://your-server-ip:1883";

// Device identity (per-floor format: {cabinet}-F{floor})
#define DEVICE_ID "D01-F1"
constexpr int DEVICE_FLOOR = 1;
// 设备上传 token，需与服务器 device_token 表一致
constexpr const char *SNAP_TOKEN = "your-snapshot-token";

// MQTT credentials — 需与服务器 EMQX 配置一致
constexpr const char *MQTT_USERNAME = "retail_device";
constexpr const char *MQTT_PASSWORD = "your-mqtt-password";

// OTA download Basic Auth password (与 nginx .htpasswd 一致)
constexpr const char *OTA_AUTH_PASSWORD = "your-ota-password";

// Topic prefix (macro for compile-time string concatenation)
#define MQTT_TOPIC_PREFIX "retail/" DEVICE_ID

// ── Camera I2C ────────────────────────────────
constexpr gpio_num_t CAM_I2C_SDA_PIN = GPIO_NUM_7;
constexpr gpio_num_t CAM_I2C_SCL_PIN = GPIO_NUM_8;
constexpr int CAM_I2C_FREQ_HZ = 100000;

constexpr gpio_num_t CAM_RESET_PIN = GPIO_NUM_NC;
constexpr gpio_num_t CAM_PWDN_PIN = GPIO_NUM_NC;
constexpr gpio_num_t CAM_XCLK_PIN = GPIO_NUM_NC;
constexpr int CAM_XCLK_FREQ_HZ = 24000000;

// ── Capture ──────────────────────────────────
constexpr int CAM_WIDTH = 800;
constexpr int CAM_HEIGHT = 800;
constexpr int CAM_USE_ISP = 1;

// JPEG encoding
constexpr int JPEG_QUALITY = 80;
constexpr int JPEG_COMPACT = CAM_WIDTH * CAM_HEIGHT;

// ── YOLO ─────────────────────────────────────
#define YOLO_ENABLED 1
constexpr int YOLO_INPUT_W = 320;
constexpr int YOLO_INPUT_H = 320;
constexpr float YOLO_SCORE_THR = 0.6f;
constexpr float YOLO_NMS_THR = 0.7f;

// ── Hardware module switches ─────────────────
constexpr bool DOOR_GPIO_ENABLED = true;
constexpr bool WEIGHT_SENSOR_ENABLED = false;
constexpr bool PRICE_DISPLAY_ENABLED = false;

// ── Door magnet sensor ─────────────────────────────
// 低电平=门合上(磁体靠近，干接点闭合)；高电平=门分开(浮空被上拉)。
// 防抖/确认参数提炼自独立测试程序 main.c。
constexpr gpio_num_t DOOR_MAGNET_GPIO  = GPIO_NUM_2;
constexpr bool       DOOR_MAGNET_PULLUP= true;     // 使能内部上拉
constexpr int       DEBOUNCE_TIME_MS  = 50;        // ISR 内防抖时间
constexpr int       CONFIRM_DELAY_MS  = 30;        // 收到事件后等待电平稳定的时间
constexpr int       CONFIRM_SAMPLES   = 51;        // 确认采样次数(~100ms窗口)
constexpr int       CONFIRM_SAMPLE_MS  = 2;        // 每次采样间隔
// 合上判定阈值: 低电平占比≥此值才算"合上"。
// 合上=100%低电平，分开(浮空噪声)约50%，故70%可干净区分。
constexpr float     CLOSED_LOW_RATIO  = 0.70f;

// ── Servo (SG90) ───────────────────────────────────
// GPIO22 输出 50Hz PWM，脉宽 1ms(关门)/2ms(开门) 驱动 SG90。
// LEDC TIMER_1/CHANNEL_1 —— 避让相机 XCLK 占用的 TIMER_0/CHANNEL_0。
constexpr gpio_num_t SERVO_GPIO         = GPIO_NUM_22;
constexpr int        SERVO_LEDC_TIMER   = 1;
constexpr int        SERVO_LEDC_CHANNEL = 1;
constexpr int        SERVO_FREQ_HZ      = 50;        // SG90 标准 50Hz(20ms 周期)
constexpr int        SERVO_ANGLE_CLOSED = 0;         // 关门角度(°)
constexpr int        SERVO_ANGLE_OPEN   = 90;        // 开门角度(°)

// ── Anomaly ──────────────────────────────────────────
constexpr int ANOMALY_LED_DURATION_MS = 5000;         // 异常红灯保持时长(ms)
constexpr int DOOR_OPEN_TIMEOUT_MS   = 60000;         // 开门超过此时间未关门→上报异常(ms)
constexpr int UNLOCK_PHOTO_TIMEOUT_MS = 8000;          // 解锁后多久没开门就自动拍照(ms)
constexpr int UNLOCK_AUTO_LOCK_MS    = 30000;          // 解锁后多久没开门就自动锁门(ms)

// ── RGB status LED ─────────────────────────────────
// 三路 GPIO 恒亮/灭混色(无 PWM 调光)。共阳/共阴一个 bool 切换。
constexpr gpio_num_t RGB_R_GPIO = GPIO_NUM_6;
constexpr gpio_num_t RGB_G_GPIO = GPIO_NUM_21;
constexpr gpio_num_t RGB_B_GPIO = GPIO_NUM_20;
constexpr bool       RGB_COMMON_ANODE = true;        // true=共阳, false=共阴
// 5 态颜色映射 [R,G,B]，0灭/1亮，与 cabinet_state_t 顺序一致:
// LOCKED=蓝, UNLOCKED=青, DOOR_OPEN=绿, ANALYZING=黄, ERROR=红
constexpr int RGB_STATE_COLORS[5][3] = {
    {0, 0, 1},  // LOCKED      蓝
    {0, 1, 1},  // UNLOCKED    青
    {0, 1, 0},  // DOOR_OPEN   绿
    {1, 1, 0},  // ANALYZING   黄
    {1, 0, 0},  // ERROR       红
};

// 门事件在状态机忙碌时排队，超过此时长(ms)的请求被丢弃。
// 取值应≥单次拍照+上传周期。默认 15s。
constexpr int       DOOR_EVT_MAX_WAIT_MS = 15000;

#endif // CONFIG_H
