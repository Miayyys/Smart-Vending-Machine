/*
 * app_events.h — Event base + cabinet state machine types
 *
 * All modules communicate through the default esp_event loop (APP_BUS).
 * The bus carries only lightweight notifications/metadata.
 * Bulk data (JPEG) stays in the producing module's internal buffer;
 * the event carries a pointer+length descriptor for consumers.
 */
#ifndef APP_EVENTS_H
#define APP_EVENTS_H

#include <stdint.h>
#include <stddef.h>
#include "esp_event.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ── Custom event base (declared here, defined in state_machine.c) ── */
ESP_EVENT_DECLARE_BASE(APP_BUS);

/* ── Event IDs posted on APP_BUS ────────────────────── */
typedef enum {
    /* Ingress (from network / hardware / console) */
    APP_EVT_DOOR_OPENED       = 0,
    APP_EVT_DOOR_CLOSED       = 1,
    APP_EVT_CMD_UNLOCK        = 2,
    APP_EVT_CMD_LOCK          = 3,
    APP_EVT_CMD_REBOOT        = 4,
    APP_EVT_CMD_SYNC          = 5,
    APP_EVT_CMD_OTA           = 6,
    APP_EVT_CMD_ANOMALY       = 7,
    APP_EVT_ERROR             = 8,
    APP_EVT_WEIGHT_CHANGED    = 9,

    /* Internal flow events */
    APP_EVT_PHOTO_READY       = 16, // payload: evt_photo_ready_t*
    APP_EVT_UPLOAD_DONE       = 17,

    /* State */
    APP_EVT_STATE_CHANGED     = 20,
    APP_EVT_ERROR_CLEAR       = 21, // 异常超时后清除,恢复上一个状态
} app_event_id_t;

/* ── Cabinet state machine ──────────────────────────── */
typedef enum {
    CABINET_LOCKED,          // 舵机锁闭，门磁忽略
    CABINET_UNLOCKED,        // 已解锁，等待门磁开门
    CABINET_DOOR_OPEN,       // 门已打开
    CABINET_ANALYZING,       // 拍照识别中
    CABINET_ERROR,           // 出错
} cabinet_state_t;

/* ── Event payload types ────────────────────────────── */

typedef struct {
    int duration_sec;
} evt_unlock_t;

typedef struct {
    const char *url;
    const char *md5;
    const char *version;
    size_t      size;
} evt_ota_t;

typedef struct {
    const char *type;    // "DOOR_FORCED", "CAMERA_FAIL", etc.
    const char *level;   // "INFO" / "WARN" / "CRIT"
    const char *detail;
} evt_error_t;

typedef struct {
    char type[32];
    char level[8];
} evt_anomaly_t;

/**
 * evt_photo_ready_t — JPEG descriptor for buffer sharing.
 *
 * After camera captures a frame, it stores the result in its internal
 * buffer and posts APP_EVT_PHOTO_READY with this descriptor.
 * Consumers read JPEG data directly from (jpeg_buf, jpeg_len)
 * — the buffer is valid until the next capture starts
 * (sequential flow: capture → consume → done → next capture).
 */
typedef struct {
    uint8_t *jpeg_buf;
    size_t   jpeg_len;
    uint32_t timestamp_ms;
} evt_photo_ready_t;

#ifdef __cplusplus
}
#endif

#endif // APP_EVENTS_H
