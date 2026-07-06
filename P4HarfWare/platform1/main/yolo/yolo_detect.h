/*
 * yolo_detect.h — C-compatible YOLO water-bottle detection API
 *
 * Wraps the C++ esp-dl model loaded from the "model" partition.
 */
#ifndef YOLO_DETECT_H
#define YOLO_DETECT_H

#include <stdint.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Detection result (single object).
 */
typedef struct {
    float  score;        // confidence (0..1)
    int    x, y;         // top-left corner (in input image coordinates)
    int    w, h;         // box size
    int    label_id;     // class id (for water_bottle_detect: 0 = water bottle)
} yolo_detection_t;

/**
 * @brief Array of detections.
 */
typedef struct {
    yolo_detection_t *items;
    int               count;
    int               capacity;
} yolo_result_t;

/**
 * @brief Initialize the YOLO model from the "model" flash partition.
 * Must be called once after NVS / partition init.
 * @return ESP_OK on success.
 */
esp_err_t yolo_init(void);

/**
 * @brief Run inference on an RGB565 image buffer.
 *
 * @param rgb565    RGB565 pixel data (little-endian).
 * @param width     image width in pixels.
 * @param height    image height in pixels.
 * @param[out] out  detection results. Caller must free out->items with free().
 * @return ESP_OK on success, ESP_ERR_NOT_SUPPORTED if model not loaded.
 */
esp_err_t yolo_detect(uint8_t *rgb565, int width, int height, yolo_result_t *out);

/**
 * @brief Check if the YOLO model is loaded and ready.
 */
bool yolo_is_ready(void);

/**
 * @brief 标记模型 OTA 激活槽（0=model_0, 1=model_1）。
 * model_task 下载完成后调用，重启后 yolo_init 从此槽加载。
 */
void model_otadata_mark_active(int slot);

#ifdef __cplusplus
}
#endif

#endif // YOLO_DETECT_H
