/*
 * upload_snapshot.h — HTTP multipart upload to cloud snapshot API
 */
#ifndef UPLOAD_SNAPSHOT_H
#define UPLOAD_SNAPSHOT_H

#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Upload a JPEG snapshot to the cloud server via HTTP multipart POST.
 *
 * POST /api/snapshot/upload
 * multipart/form-data fields: token, deviceId, floor, doorAction, file
 *
 * @param jpeg_buf     JPEG image buffer (heap, caller owns)
 * @param jpeg_len     byte length of JPEG
 * @param door_action  "OPEN" or "CLOSE"
 * @return ESP_OK on HTTP 200, ESP_FAIL otherwise.
 */
esp_err_t upload_snapshot(const uint8_t *jpeg_buf, size_t jpeg_len,
                          const char *door_action);

#ifdef __cplusplus
}
#endif

#endif // UPLOAD_SNAPSHOT_H
