#include "bus/state_machine.h"
#include "bus/app_events.h"
#include "config.h"
#include "network/wifi_mqtt.h"
#include "camera/camera_pipeline.h"
#include "network/upload_snapshot.h"
#include "yolo/yolo_detect.h"
#include "indicators/servo.h"
#include "indicators/rgb_led.h"
#include "esp_log.h"
#include "esp_event.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_https_ota.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_http_client.h"
#include "esp_rom_md5.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include <cstring>
#include <cstdlib>
#include <cstdio>

static const char *TAG = "cabinet";

ESP_EVENT_DEFINE_BASE(APP_BUS);

// ── Static pointers set by cabinet_init() ──────────────────────
static WifiMqtt      *s_mqtt      = nullptr;
static CameraPipeline *s_camera    = nullptr;

// ── State machine ──────────────────────────────────────────────
static cabinet_state_t s_state    = CABINET_LOCKED;
static cabinet_state_t s_prev_state = CABINET_LOCKED; // 异常前状态

// ── 异常自动恢复定时器 ─────────────────────────────────────────
static esp_timer_handle_t s_anomaly_timer = nullptr;
static esp_timer_handle_t s_door_open_timer = nullptr; // 开门超时

// 自签名服务器证书（由 CMakeLists.txt 的 EMBED_TXTFILES 嵌入）
extern const char server_cert_pem_start[] asm("_binary_server_cert_pem_start");
extern const char server_cert_pem_end[]   asm("_binary_server_cert_pem_end");

// ── 同一购买事件的批次ID(OPEN/CLOSE 共用) ─────────────────────
static char s_batch_id[24] = "";
static void gen_batch_id(void)
{
    uint32_t t = (uint32_t)(esp_timer_get_time() / 1000);
    snprintf(s_batch_id, sizeof(s_batch_id), "uuid-%08lx", (unsigned long)t);
}
static const char *pid_to_label(int pid)
{
    // 与 data.yaml 的 names 顺序一致: 0=nongfu, 1=runtian, 2=soda, 3=yogurt(4类模型)
    switch (pid) {
        case 0:  return "nongfu";
        case 1:  return "runtian";
        case 2:  return "soda";
        case 3:  return "yogurt";
        default: return "unknown";
    }
}
static TaskHandle_t    s_work_task = nullptr;
static SemaphoreHandle_t s_work_sem = nullptr;
static const char     *s_door_action = "OPEN";

// ── Pending door requests (queued while state machine busy) ───
// 事件到达时若状态机正忙(ANALYZING/DOOR_OPEN)，不立即推状态，而是带时间戳
// 入队；work_task 每个周期结束后取下一个未超时的请求处理。超时请求丢弃。
typedef struct {
    app_event_id_t evt;      // APP_EVT_DOOR_OPENED / _CLOSED
    int64_t        posted_at; // us since boot (esp_timer_get_time)
} pending_door_req_t;

static QueueHandle_t s_pending_door_q = nullptr;

static constexpr const char *state_str(cabinet_state_t s) {
    return s == CABINET_LOCKED      ? "LOCKED" :
           s == CABINET_UNLOCKED    ? "UNLOCKED" :
           s == CABINET_DOOR_OPEN   ? "DOOR_OPEN" :
           s == CABINET_ANALYZING   ? "ANALYZING" :
           s == CABINET_ERROR       ? "ERROR" : "?";
}

static bool transition_allowed(cabinet_state_t from, cabinet_state_t to)
{
    // LOCKED → UNLOCKED | ANALYZING | ERROR
    // UNLOCKED → DOOR_OPEN | LOCKED | ANALYZING | ERROR
    // DOOR_OPEN → ANALYZING | LOCKED | ERROR
    // ANALYZING → LOCKED | DOOR_OPEN | ANALYZING | ERROR (ANALYZING→ANALYZING 允许接续拍照)
    // ERROR → all valid states
    if (from == CABINET_LOCKED)      return to == CABINET_UNLOCKED   || to == CABINET_ANALYZING || to == CABINET_ERROR;
    if (from == CABINET_UNLOCKED)    return to == CABINET_DOOR_OPEN  || to == CABINET_LOCKED   || to == CABINET_ANALYZING || to == CABINET_ERROR;
    if (from == CABINET_DOOR_OPEN)   return to == CABINET_ANALYZING  || to == CABINET_LOCKED   || to == CABINET_ERROR;
    if (from == CABINET_ANALYZING)   return to == CABINET_LOCKED     || to == CABINET_DOOR_OPEN || to == CABINET_ANALYZING || to == CABINET_ERROR;
    if (from == CABINET_ERROR)       return to == CABINET_LOCKED || to == CABINET_UNLOCKED || to == CABINET_DOOR_OPEN || to == CABINET_ANALYZING;
    return false;
}

static esp_err_t set_state(cabinet_state_t ns)
{
    if (!transition_allowed(s_state, ns)) {
        ESP_LOGW(TAG, "Transition %s → %s not allowed", state_str(s_state), state_str(ns));
        return ESP_ERR_INVALID_STATE;
    }
    cabinet_state_t old = s_state;
    s_state = ns;
    ESP_LOGI(TAG, "%s → %s", state_str(old), state_str(ns));
    rgb_set_state(ns);   // 同步刷新状态指示灯

    // 开门超时计时：进入 DOOR_OPEN 启动，离开即取消
    if (ns == CABINET_DOOR_OPEN) {
        if (s_door_open_timer)
            esp_timer_start_once(s_door_open_timer, DOOR_OPEN_TIMEOUT_MS * 1000);
    } else if (old == CABINET_DOOR_OPEN && s_door_open_timer) {
        esp_timer_stop(s_door_open_timer);
    }
    return ESP_OK;
}

// ── MQTT report helpers ────────────────────────────────────────
static void mqtt_report(const char *topic, const char *fmt, ...)
{
    if (!s_mqtt) return;
    char json[256];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(json, sizeof(json), fmt, ap);
    va_end(ap);
    s_mqtt->publish(topic, json);
}

// ── 异常灯 + 自动恢复 ───────────────────────────────────────
static void trigger_anomaly(const char *type, const char *level); // forward

static void anomaly_timeout_cb(void *arg)
{
    (void)arg;
    esp_event_post(APP_BUS, APP_EVT_ERROR_CLEAR, NULL, 0, 0);
}

static void door_open_timeout_cb(void *arg)
{
    (void)arg;
    ESP_LOGW(TAG, "Door open > %dms, no close", DOOR_OPEN_TIMEOUT_MS);
    trigger_anomaly("DOOR_OPEN_LONG", "WARN"); // 上报但不等close—close到了正常锁门
}

static void trigger_anomaly(const char *type, const char *level)
{
    if (s_state == CABINET_ERROR) return; // 已在异常，不重复触发
    s_prev_state = s_state;
    ESP_LOGW(TAG, "Anomaly: %s/%s (from %s)", type, level, state_str(s_state));
    mqtt_report(MQTT_TOPIC_EVENT_ANOMALY, R"({"type":"%s","level":"%s"})", type, level);
    set_state(CABINET_ERROR);
    if (s_anomaly_timer)
        esp_timer_start_once(s_anomaly_timer, ANOMALY_LED_DURATION_MS * 1000);
}

// ── Work task (heavy lifting: capture → upload → report) ──────
// 一个拍照周期结束后，若待办门事件队列里有未超时请求，立即接续下一周期。
static void work_task(void *)
{
    while (true) {
        xSemaphoreTake(s_work_sem, portMAX_DELAY);
photo_cycle:
        const char *door = s_door_action;
        ESP_LOGI(TAG, "=== Photo cycle (door=%s) ===", door);

        // 从 UNLOCKED/DOOR_OPEN/LOCKED(SYNC) 推进到 ANALYZING
        if (s_state == CABINET_DOOR_OPEN || s_state == CABINET_UNLOCKED)
            set_state(CABINET_ANALYZING);
        else if (s_state == CABINET_LOCKED)
            set_state(CABINET_ANALYZING);       // SYNC 命令直接推进
        else if (s_state != CABINET_ANALYZING) continue;

        // 1. Capture JPEG
        uint8_t *jpeg_copy = nullptr;
        size_t   jpeg_len  = 0;
        if (!s_camera || s_camera->captureJpeg(&jpeg_copy, &jpeg_len) != ESP_OK) {
            ESP_LOGE(TAG, "Capture failed");
            trigger_anomaly("CAMERA_FAIL", "WARN");
            continue;
        }
        ESP_LOGI(TAG, "Captured %d bytes", int(jpeg_len));

        // ── YOLO inference ──
        yolo_result_t yr{};
        if constexpr (YOLO_ENABLED) {
            uint32_t rw = 0, rh = 0;
            auto *buf = static_cast<uint8_t *>(heap_caps_malloc(
                s_camera->width() * s_camera->height() * 2, MALLOC_CAP_SPIRAM));
            if (!buf) {
                ESP_LOGE(TAG, "YOLO: SPIRAM alloc %d failed",
                         int(s_camera->width() * s_camera->height() * 2));
            } else if (s_camera->captureRawRgb565(buf, &rw, &rh) != ESP_OK) {
                ESP_LOGE(TAG, "YOLO: captureRawRgb565 failed");
            } else {
                esp_err_t yret = yolo_detect(buf, rw, rh, &yr);
                if (yret != ESP_OK) {
                    ESP_LOGE(TAG, "YOLO: detect failed: %s", esp_err_to_name(yret));
                } else if (yr.count == 0) {
                    ESP_LOGW(TAG, "YOLO: no objects detected");
                } else {
                    ESP_LOGI(TAG, "YOLO: %d obj", yr.count);
                    for (int i = 0; i < yr.count; ++i) {
                        auto &d = yr.items[i];
                        ESP_LOGI(TAG, "  [%d] label=%d score=%.2f (%d,%d %dx%d)",
                                 i, d.label_id, double(d.score),
                                 d.x, d.y, d.w, d.h);
                    }
                }
            }
            if (buf) free(buf);
        }

        // 2. Zero-copy descriptor for event-loop consumers
        const uint8_t *internal = nullptr;
        size_t ilen = 0;
        if (s_camera) s_camera->getLastJpeg(&internal, &ilen);

        // 3. Upload
        auto up = upload_snapshot(jpeg_copy, jpeg_len, door);
        free(jpeg_copy);

        // 4. Build detect JSON → event/detect (batch_id + label string + x1y1x2y2)
        if (strcmp(door, "OPEN") == 0 || strcmp(door, "SYNC") == 0 || s_batch_id[0] == 0)
            gen_batch_id();

        char det_json[2048];
        int off = snprintf(det_json, sizeof(det_json),
            R"({"batch_id":"%s","door_action":"%s","detections":[)",
            s_batch_id, door);
        for (int i = 0; i < yr.count && off < (int)sizeof(det_json) - 100; i++) {
            auto &d = yr.items[i];
            off += snprintf(det_json + off, sizeof(det_json) - off,
                R"(%s{"label":"%s","score":%.2f,"x1":%d,"y1":%d,"x2":%d,"y2":%d})",
                (i == 0) ? "" : ",",
                pid_to_label(d.label_id), double(d.score),
                d.x, d.y, d.x + d.w, d.y + d.h);
        }
        if (off < (int)sizeof(det_json) - 2)
            off += snprintf(det_json + off, sizeof(det_json) - off, "]}");

        // 5. MQTT: only event/detect (直发,绕过mqtt_report小缓冲区)
        if (up != ESP_OK) ESP_LOGW(TAG, "Upload failed");
        if (s_mqtt) s_mqtt->publish(MQTT_TOPIC_EVENT_DETECT, det_json);

        if (strcmp(door, "CLOSE") == 0)
            s_batch_id[0] = 0;  // 关闭批次

        if (yr.items) free(yr.items);

        // ── 查待办队列 ──
        pending_door_req_t req;
        bool has_next = false;
        while (xQueueReceive(s_pending_door_q, &req, 0) == pdTRUE) {
            int64_t age_ms = (esp_timer_get_time() - req.posted_at) / 1000;
            if (age_ms > DOOR_EVT_MAX_WAIT_MS) {
                ESP_LOGW(TAG, "Drop stale door req (age=%lldms)", (long long)age_ms);
                continue;
            }
            has_next = true;
            break;
        }

        if (!has_next) {
            // 无待办：根据本周期类型决定去向
            if (strcmp(door, "SYNC") == 0 || strcmp(door, "CLOSE") == 0)
                set_state(CABINET_LOCKED);        // SYNC/关门拍照完成
            else
                set_state(CABINET_DOOR_OPEN);      // 开门拍照完成，保持开门状态等关门
            continue;  // 回 xSemaphoreTake 等待
        }

        // 有待办：接续下一轮拍照（不经过 IDLE）
        if (req.evt == APP_EVT_DOOR_OPENED) {
            set_state(CABINET_DOOR_OPEN);
            s_door_action = "OPEN";
        } else {
            set_state(CABINET_ANALYZING);
            s_door_action = "CLOSE";
        }
        goto photo_cycle;
    }
}

// ── 门事件路由 ────────────────────────────────────────────
// 开门事件(OPENED)：仅当 UNLOCKED 时才处理→推进DOOR_OPEN→触发拍照。
//                      LOCKED 时开门→强制开门异常。
// 关门事件(CLOSED)：始终立即锁舵机→按状态决定后续。
static void handle_door_event(app_event_id_t evt)
{
    cabinet_state_t s = s_state;

    if (evt == APP_EVT_DOOR_OPENED) {
        if (s == CABINET_LOCKED) {
            trigger_anomaly("LOCK_MISMATCH", "CRIT"); // 锁着门开了→强制开门
            return;
        }
        if (s != CABINET_UNLOCKED) return;   // 未解锁，忽略
        set_state(CABINET_DOOR_OPEN);
        s_door_action = "OPEN";
        xSemaphoreGive(s_work_sem);
        return;
    }

    // APP_EVT_DOOR_CLOSED
    if (s == CABINET_LOCKED) return;         // 已锁，忽略
    servo_close();                            // 关门立即锁舵机

    if (s == CABINET_UNLOCKED) {
        set_state(CABINET_LOCKED);            // 没开过门，直接回锁
        return;
    }
    if (s == CABINET_DOOR_OPEN) {             // 门开过→关门拍照
        s_door_action = "CLOSE";
        xSemaphoreGive(s_work_sem);
        return;
    }
    // ANALYZING/DOOR_OPEN：入队
    pending_door_req_t req{evt, esp_timer_get_time()};
    xQueueSend(s_pending_door_q, &req, 0);
}

// ── OTA task ───────────────────────────────────────────────────
// OTA 下载参数: url + 可选的 md5（来自 MQTT 指令的 md5 字段，hex 字符串，32 位小写）
// md5 为空字符串表示不校验完整性（不推荐，但保留兼容）。
typedef struct {
    char url[512];
    char md5[33];   // 32 hex + '\0'
} ota_params_t;

// 把字节流送入 ROM MD5 context, 下载完校验 hex 摘要。
// 返回 true = 校验通过 (或 md5 为空跳过)
static bool ota_verify_md5(md5_context_t *ctx, const char *expected_hex) {
    if (!expected_hex || expected_hex[0] == 0) return true; // 无预期值, 跳过
    uint8_t digest[16];
    esp_rom_md5_final(digest, ctx);
    char hex[33];
    for (int i = 0; i < 16; ++i)
        snprintf(hex + i*2, 3, "%02x", digest[i]);
    hex[32] = 0;
    if (strcasecmp(hex, expected_hex) != 0) {
        ESP_LOGE(TAG, "MD5 mismatch: got=%s expected=%s", hex, expected_hex);
        return false;
    }
    ESP_LOGI(TAG, "MD5 OK: %s", hex);
    return true;
}

// 从 MQTT JSON 中解析 url 和 md5 (md5 字段可选)
static ota_params_t *ota_parse_params(const char *data) {
    auto *p = new (std::nothrow) ota_params_t{};
    if (!p) return nullptr;
    p->md5[0] = 0;
    // url
    auto *u = strstr(data, "\"url\"");
    if (!u) { delete p; return nullptr; }
    u = strchr(u, ':'); u = strchr(u, '"');
    if (!u) { delete p; return nullptr; }
    snprintf(p->url, sizeof(p->url), "%s", u + 1);
    char *q = strchr(p->url, '"'); if (q) *q = 0;
    // 相对路径补全
    if (p->url[0] == '/') {
        char full[576];
        snprintf(full, sizeof(full), "https://%s%s", SERVER_HOST, p->url);
        strlcpy(p->url, full, sizeof(p->url));
    }
    // md5 (可选)
    auto *m = strstr(data, "\"md5\"");
    if (m) {
        m = strchr(m, ':'); m = strchr(m, '"');
        if (m) {
            snprintf(p->md5, sizeof(p->md5), "%s", m + 1);
            char *e = strchr(p->md5, '"'); if (e) *e = 0;
        }
    }
    return p;
}

static void ota_task(void *arg)
{
    auto *params = static_cast<ota_params_t *>(arg);
    const char *url = params->url;
    const char *expected_md5 = params->md5;
    ESP_LOGI(TAG, "Firmware OTA from: %s (md5=%s)", url, expected_md5[0] ? expected_md5 : "skip");

    mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
        R"({"type":"firmware","version":"","status":"downloading","progress":0,"message":""})");

    esp_ota_handle_t ota_handle = 0;

    // lambda 统一失败退出
    auto fail = [params](const char *msg) {
        ESP_LOGE(TAG, "%s", msg);
        mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
            R"({"type":"firmware","version":"","status":"failed","progress":0,"message":"%s"})", msg);
        rgb_set_state(CABINET_LOCKED); // 恢复待机灯, 旧固件未切换继续运行
        delete params;
        vTaskDelete(nullptr);
    };

    // 1. 确定 OTA 目标分区（当前运行分区的对端）
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *update_part = esp_ota_get_next_update_partition(running);
    if (!update_part)
        return fail("No OTA partition found");
    ESP_LOGI(TAG, "running=%s target=%s @ 0x%lx",
             running ? running->label : "?",
             update_part->label, (long)update_part->address);

    // OTA 进行中 → 紫灯
    rgb_set_state(CABINET_ANALYZING); // OTA 进行中→黄灯

    // 2. HTTP 下载
    esp_http_client_config_t http{};
    http.url                          = url;
    http.username                     = "admin";
    http.password                     = OTA_AUTH_PASSWORD;
    http.auth_type                    = HTTP_AUTH_TYPE_BASIC;
    http.buffer_size                  = 32768;
    http.timeout_ms                   = 60000;
    http.cert_pem                     = server_cert_pem_start;
    http.skip_cert_common_name_check  = true;

    auto *client = esp_http_client_init(&http);
    if (!client)
        return fail("HTTP client init failed");

    if (esp_http_client_open(client, 0) != ESP_OK) {
    esp_http_client_cleanup(client);
        return fail("HTTP open failed");
    }

    int content_len = esp_http_client_fetch_headers(client);
    if (content_len <= 0) {
    esp_http_client_cleanup(client);
        return fail("Invalid content length");
    }
    ESP_LOGI(TAG, "Firmware size: %d", content_len);

    if ((uint32_t)content_len > update_part->size) {
    esp_http_client_cleanup(client);
        return fail("Firmware too large for partition");
    }

    // 3. 擦除 + 写入 OTA 分区
    esp_err_t err = esp_ota_begin(update_part, OTA_SIZE_UNKNOWN, &ota_handle);
    if (err != ESP_OK) {
        esp_http_client_cleanup(client);
        return fail("esp_ota_begin failed");
    }

    auto *buf = (uint8_t *)heap_caps_malloc(32768, MALLOC_CAP_SPIRAM);
    if (!buf) return fail("OOM for download buffer");

    // MD5 边下边算
    md5_context_t md5ctx;
    esp_rom_md5_init(&md5ctx);

    int total_read = 0;
    int last_pct = -1;
    int64_t t0 = esp_timer_get_time();

    while (total_read < content_len) {
        int r = esp_http_client_read(client, (char *)buf, 32768);
        if (r < 0) {
            free(buf);
            esp_ota_abort(ota_handle);
            esp_http_client_cleanup(client);
            return fail("Read error during download");
        }
        if (r == 0) break;
        err = esp_ota_write(ota_handle, (const void *)buf, r);
        if (err != ESP_OK) {
            free(buf);
            esp_ota_abort(ota_handle);
            esp_http_client_cleanup(client);
            return fail("esp_ota_write failed");
        }
        esp_rom_md5_update(&md5ctx, buf, r);
        total_read += r;

        int pct = total_read * 100 / content_len;
        if (pct / 10 != last_pct / 10) {
            last_pct = pct;
            int64_t dt_us = esp_timer_get_time() - t0;
            int kbps = (dt_us > 0) ? (int)((int64_t)total_read * 1000000 / dt_us / 1024) : 0;
            ESP_LOGI(TAG, "OTA: %d%% (%d/%d) %d KB/s", pct, total_read, content_len, kbps);
            mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
                R"({"type":"firmware","version":"","status":"downloading","progress":%d,"message":"%d/%d bytes"})",
                pct, total_read, content_len);
        }
    }

    free(buf);
    esp_http_client_cleanup(client);

    // 完整性 1: 下载字节数必须等于 content_len, 否则截断
    if (total_read != content_len) {
        esp_ota_abort(ota_handle);
        ESP_LOGE(TAG, "Download truncated: %d/%d", total_read, content_len);
        return fail("Download size mismatch (truncated)");
    }

    // 4. 完成 OTA，切换启动分区
    err = esp_ota_end(ota_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "ota_end: %s", esp_err_to_name(err));
        return fail("esp_ota_end failed");
    }

    // 完整性 2: MD5 校验。失败则不切换分区, 旧固件继续运行 (ESP-IDF bootloader 也有回退保底)
    if (!ota_verify_md5(&md5ctx, expected_md5)) {
        // 分区已被写过, 但未 set_boot_partition, 重启仍跑旧分区
        return fail("MD5 verification failed, keep old firmware");
    }

    err = esp_ota_set_boot_partition(update_part);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "set_boot: %s", esp_err_to_name(err));
        return fail("esp_ota_set_boot_partition failed");
    }

    mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
        R"({"type":"firmware","version":"","status":"success","progress":100,"message":""})");
    vTaskDelay(pdMS_TO_TICKS(500));
    ESP_LOGI(TAG, "OTA OK (%d bytes), rebooting…", total_read);
    esp_restart();
}

// ── Model partition update task ──────────────────────────────────
static void model_task(void *arg)
{
    auto *params = static_cast<ota_params_t *>(arg);
    const char *url = params->url;
    const char *expected_md5 = params->md5;
    ESP_LOGI(TAG, "Model update from: %s (md5=%s)", url, expected_md5[0] ? expected_md5 : "skip");

    mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
        R"({"type":"model","version":"","status":"downloading","progress":0,"message":""})");

    rgb_set_state(CABINET_ANALYZING); // OTA 进行中→黄灯

    esp_http_client_config_t http{};
    http.url                          = url;
    http.username                     = "admin";
    http.password                     = OTA_AUTH_PASSWORD;
    http.auth_type                    = HTTP_AUTH_TYPE_BASIC;
    http.buffer_size                  = 32768;
    http.timeout_ms                   = 60000;
    http.cert_pem                     = server_cert_pem_start;
    http.skip_cert_common_name_check  = true;

    auto *client = esp_http_client_init(&http);
    if (!client) {
        ESP_LOGE(TAG, "HTTP client init failed");
        mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
            R"({"type":"model","version":"","status":"failed","progress":0,"message":"HTTP client init failed"})");
        delete params;
        vTaskDelete(nullptr);
        return;
    }

    // lambda 统一清理退出（带失败上报, 不切激活槽）
    auto quit = [client, params](const char *reason) {
        ESP_LOGE(TAG, "%s", reason);
        mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
            R"({"type":"model","version":"","status":"failed","progress":0,"message":"%s"})", reason);
        rgb_set_state(CABINET_LOCKED);
    esp_http_client_cleanup(client);
        delete params;
        vTaskDelete(nullptr);
    };

    if (esp_http_client_open(client, 0) != ESP_OK)
        return quit("HTTP open failed");

    int content_len = esp_http_client_fetch_headers(client);
    if (content_len <= 0)
        return quit("Invalid content length");
    ESP_LOGI(TAG, "Model file size: %d", content_len);

    // ── 确定目标槽（非活跃槽） ──
    const esp_partition_t *ota = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)0x40, "model_otadata");
    if (!ota) return quit("model_otadata partition not found");
    uint8_t active_flag = 0xFF;
    esp_partition_read(ota, 0, &active_flag, 1);
    int active_slot = (active_flag == 1) ? 1 : 0;
    int target_slot = 1 - active_slot;
    const char *target_name = (target_slot == 0) ? "model_0" : "model_1";
    esp_partition_subtype_t target_type = (target_slot == 0) ?
        (esp_partition_subtype_t)0x41 : (esp_partition_subtype_t)0x42;
    ESP_LOGI(TAG, "active=%s → target=%s", (active_slot ? "model_1" : "model_0"), target_name);

    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, target_type, target_name);
    if (!part)
        return quit("Target partition not found");
    ESP_LOGI(TAG, "%s: offset=0x%lx size=%ld", target_name,
             (long)part->address, (long)part->size);

    if ((uint32_t)content_len > part->size)
        return quit("Model too large for target");

    if (esp_partition_erase_range(part, 0, part->size) != ESP_OK)
        return quit("Erase target failed");

    // Download + write loop (边下边算 MD5)
    auto *buf = (uint8_t *)heap_caps_malloc(32768, MALLOC_CAP_SPIRAM);
    if (!buf) return quit("OOM for download buffer");

    md5_context_t md5ctx;
    esp_rom_md5_init(&md5ctx);

    int total_read = 0;
    size_t write_off = 0;
    int last_pct = -1;

    while (total_read < content_len) {
        int r = esp_http_client_read(client, (char *)buf, 32768);
        if (r < 0) { free(buf); return quit("Read error during download"); }
        if (r == 0) break;
        if (esp_partition_write(part, write_off, buf, r) != ESP_OK) {
            free(buf);
            return quit("Write to target failed");
        }
        esp_rom_md5_update(&md5ctx, buf, r);
        total_read += r;
        write_off += r;

        int pct = total_read * 100 / content_len;
        if (pct / 10 != last_pct / 10) {
            last_pct = pct;
            ESP_LOGI(TAG, "Model download: %d%% (%d/%d)", pct, total_read, content_len);
            mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
                R"({"type":"model","version":"","status":"downloading","progress":%d,"message":"%d/%d bytes"})",
                pct, total_read, content_len);
        }
    }

    free(buf);
    esp_http_client_cleanup(client);

    if (total_read != content_len)
        return quit("Download size mismatch");

    // 完整性校验: MD5, 协议中给定则必须匹配
    if (!ota_verify_md5(&md5ctx, expected_md5)) {
        ESP_LOGE(TAG, "Model MD5 mismatch, new model NUKED — keep old slot active");
        return quit("MD5 verification failed");
    }

    // 可加载性校验: 在切激活槽前验证新模型能被 dl::Model 加载
    if constexpr (YOLO_ENABLED) {
        if (yolo_verify_slot(target_slot) != ESP_OK)
            return quit("Model load verification failed, keep old model");
    }

    // ── 全通过, 切激活槽 ──
    uint8_t new_flag = (target_slot == 1) ? 1 : 0;
    esp_partition_erase_range(ota, 0, ota->size);
    esp_partition_write(ota, 0, &new_flag, 1);
    ESP_LOGI(TAG, "Model slot switched: %s → %s",
             (active_slot ? "model_1" : "model_0"), target_name);

    mqtt_report(MQTT_TOPIC_OTA_PROGRESS,
        R"({"type":"model","version":"","status":"success","progress":100,"message":"switched to %s"})", target_name);
    vTaskDelay(pdMS_TO_TICKS(500));
    ESP_LOGI(TAG, "Model update OK (%d bytes), rebooting…", total_read);
    esp_restart();
}

// ── Bus event handler ──────────────────────────────────────────
static void bus_event(void *, esp_event_base_t, int32_t id, void *data)
{
    switch (app_event_id_t(id)) {
    case APP_EVT_DOOR_OPENED:
        handle_door_event(APP_EVT_DOOR_OPENED);
        break;
    case APP_EVT_DOOR_CLOSED:
        handle_door_event(APP_EVT_DOOR_CLOSED);
        break;
    case APP_EVT_CMD_UNLOCK: {
        auto *u = static_cast<evt_unlock_t *>(data);
        ESP_LOGI(TAG, "UNLOCK %ds", u ? u->duration_sec : 30);
        servo_open();                       // 解锁舵机
        set_state(CABINET_UNLOCKED);         // 待开门状态，门磁开始工作
        break;
    }
    case APP_EVT_CMD_LOCK:
        ESP_LOGI(TAG, "LOCK");
        servo_close();
        set_state(CABINET_LOCKED);
        break;
    case APP_EVT_CMD_REBOOT:
        ESP_LOGI(TAG, "REBOOT");
        esp_restart();
        break;
    case APP_EVT_CMD_SYNC:
        ESP_LOGI(TAG, "SYNC → photo cycle");
        cabinet_photo_cycle("SYNC");
        break;
    case APP_EVT_CMD_OTA: {
        auto *ota = static_cast<evt_ota_t *>(data);
        auto *params = new (std::nothrow) ota_params_t{};
        if (params && ota && ota->url) {
            snprintf(params->url, sizeof(params->url), "%s", ota->url);
            // 相对路径补全
            if (params->url[0] == '/') {
                char full[576];
                snprintf(full, sizeof(full), "https://%s%s", SERVER_HOST, params->url);
                strlcpy(params->url, full, sizeof(params->url));
            }
            if (ota->md5) snprintf(params->md5, sizeof(params->md5), "%s", ota->md5);
            xTaskCreate(ota_task, "ota", 8192, params, 5, nullptr);
        } else {
            delete params;
        }
        break;
    }
    case APP_EVT_CMD_ANOMALY: {
        auto *a = static_cast<evt_anomaly_t *>(data);
        ESP_LOGW(TAG, "Server anomaly: %s/%s", a->type, a->level);
        trigger_anomaly(a->type, a->level);
        break;
    }
    case APP_EVT_ERROR:
        trigger_anomaly("LOCAL_ERROR", "WARN");
        break;
    case APP_EVT_ERROR_CLEAR: {
        cabinet_state_t prev = s_prev_state;
        set_state(prev);
        break;
    }
    default:
        break;
    }
}

// ── MQTT command dispatcher (called from MQTT task) ───────────
static void on_mqtt_msg(const char *topic, const char *data, int)
{
    ESP_LOGI(TAG, "MQTT rx: %s", topic);
    auto *slash = strrchr(topic, '/');
    auto *action = slash ? slash + 1 : topic;

    if      (strcmp(action, "unlock") == 0) {
        evt_unlock_t ev{30};
        auto *d = strstr(data, "\"duration\"");
        if (d) ev.duration_sec = atoi(strchr(d, ':') + 1);
        esp_event_post(APP_BUS, APP_EVT_CMD_UNLOCK, &ev, sizeof(ev), 0);
    }
    else if (strcmp(action, "lock")    == 0) esp_event_post(APP_BUS, APP_EVT_CMD_LOCK,    nullptr, 0, 0);
    else if (strcmp(action, "reboot")  == 0) esp_event_post(APP_BUS, APP_EVT_CMD_REBOOT,  nullptr, 0, 0);
    else if (strcmp(action, "sync")    == 0) esp_event_post(APP_BUS, APP_EVT_CMD_SYNC,    nullptr, 0, 0);
    else if (strcmp(action, "ota")     == 0) {
        // type: "firmware"(默认) / "model"; ota_parse_params 解析 url + md5
        bool is_model = (strstr(data, "\"type\":\"model\"") != NULL)
                     || (strstr(data, "\"type\": \"model\"") != NULL);
        auto *params = ota_parse_params(data);
        if (params) {
            xTaskCreate(is_model ? model_task : ota_task,
                is_model ? "model" : "ota", 8192, params, 5, nullptr);
        } else {
            ESP_LOGW(TAG, "OTA: failed to parse url from payload");
        }
    }
    else if (strcmp(action, "err") == 0) {
        evt_anomaly_t ev{};
        snprintf(ev.type, sizeof(ev.type), "%s", "SERVER_ANOMALY");
        snprintf(ev.level, sizeof(ev.level), "%s", "WARN");
        auto *p = strstr(data, "\"type\"");
        if (p) {
            p = strchr(p, ':');
            p = strchr(p, '"');
            if (p) {
                char buf[32];
                snprintf(buf, 32768, "%s", p + 1);
                auto *q = strchr(buf, '"');
                if (q) *q = 0;
                snprintf(ev.type, sizeof(ev.type), "%s", buf);
            }
        }
        esp_event_post(APP_BUS, APP_EVT_CMD_ANOMALY, &ev, sizeof(ev), 0);
    }
    else ESP_LOGW(TAG, "Unknown cmd: %s", action);
}

// ── Public API ─────────────────────────────────────────────────

const char *cabinet_state_str(cabinet_state_t s) { return state_str(s); }
cabinet_state_t cabinet_get_state()             { return s_state; }

int cabinet_photo_cycle(const char *door)
{
    s_door_action = door ? door : "OPEN";
    xSemaphoreGive(s_work_sem);
    return 0;
}

void cabinet_on_mqtt_msg(const char *topic, const char *data, int len)
{
    on_mqtt_msg(topic, data, len);
}

esp_err_t cabinet_init(WifiMqtt *mqtt, CameraPipeline *cam)
{
    s_mqtt   = mqtt;
    s_camera = cam;

    esp_err_t ret = esp_event_loop_create_default();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE)
        return ret;
    ESP_ERROR_CHECK(esp_event_handler_register(APP_BUS, ESP_EVENT_ANY_ID, &bus_event, nullptr));

    s_work_sem = xSemaphoreCreateBinary();
    if (!s_work_sem) return ESP_ERR_NO_MEM;

    s_pending_door_q = xQueueCreate(8, sizeof(pending_door_req_t));
    if (!s_pending_door_q) return ESP_ERR_NO_MEM;

    xTaskCreate(work_task, "cabinet_work", 12288, nullptr, tskIDLE_PRIORITY + 3, &s_work_task);

    // 异常自动恢复定时器
    esp_timer_create_args_t timer_arg = { .callback = &anomaly_timeout_cb };
    esp_timer_create(&timer_arg, &s_anomaly_timer);
    esp_timer_create_args_t door_arg = { .callback = &door_open_timeout_cb };
    esp_timer_create(&door_arg, &s_door_open_timer);

    // 指示设备：RGB 状态灯 + 舵机(初始关门)
    if (rgb_init() == ESP_OK)  rgb_set_state(CABINET_LOCKED);
    if (servo_init() == ESP_OK) servo_close();

    return ESP_OK;
}
