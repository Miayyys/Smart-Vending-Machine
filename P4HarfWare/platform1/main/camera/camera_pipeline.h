/*
 * camera_pipeline.h — ISP→PPA→JPEG pipeline as a C++ class.
 *
 * Pipeline:  OV5647 MIPI RAW8 → ISP → RGB565 → PPA rotate → JPEG.
 * All V4L2 / ISP / JPEG encoder state lives inside the class.
 * Destroy the instance to release all resources.
 */
#ifndef CAMERA_PIPELINE_H
#define CAMERA_PIPELINE_H

#include <cstdint>
#include <cstddef>
#include "esp_err.h"
#include "driver/jpeg_encode.h"

class CameraPipeline {
public:
    CameraPipeline() = default;
    ~CameraPipeline();

    // Non-copyable, non-movable
    CameraPipeline(const CameraPipeline &) = delete;
    CameraPipeline &operator=(const CameraPipeline &) = delete;

    /**
     * @brief Initialise sensor, ISP, JPEG encoder, PPA rotation.
     */
    esp_err_t init();

    /**
     * @brief Capture one frame → PPA rotate → JPEG encode.
     * @param[out] jpeg_out  heap-allocated JPEG (caller must free).
     * @param[out] jpeg_len  byte length.
     */
    esp_err_t captureJpeg(uint8_t **jpeg_out, size_t *jpeg_len);

    /**
     * @brief Zero-copy pointer to the last JPEG (valid until next capture).
     */
    esp_err_t getLastJpeg(const uint8_t **buf, size_t *len) const;

    /**
     * @brief Capture a raw RGB565 frame for YOLO / internal use.
     * Caller provides a buffer sized width() * height() * 2.
     */
    esp_err_t captureRawRgb565(uint8_t *out, uint32_t *w, uint32_t *h);

    /** @brief Output width after PPA rotation (0 = raw sensor width). */
    uint32_t width() const { return rot_w_ ? rot_w_ : frame_w_; }

    /** @brief Output height after PPA rotation (0 = raw sensor height). */
    uint32_t height() const { return rot_h_ ? rot_h_ : frame_h_; }

    /** @brief Whether the pipeline was initialised successfully. */
    explicit operator bool() const { return video_fd_ >= 0; }

private:
    esp_err_t xclkInit_();
    esp_err_t jpegEncoderInit_();
    static esp_err_t v4l2SetCtrl_(int fd, uint32_t id, int32_t value);

    int            video_fd_      = -1;
    uint8_t       *frame_bufs_[2] = {};
    uint32_t       frame_buf_size_ = 0;
    uint32_t       frame_w_       = 0;
    uint32_t       frame_h_       = 0;
    uint32_t       pixelformat_   = 0;

    jpeg_encoder_handle_t jpeg_handle_ = nullptr;
    uint8_t              *jpeg_buf_    = nullptr;
    size_t                jpeg_buf_size_ = 0;
    size_t                last_jpeg_len_ = 0;

    uint8_t *rot_buf_ = nullptr;
    uint32_t rot_w_   = 0;
    uint32_t rot_h_   = 0;
};

#endif // CAMERA_PIPELINE_H
