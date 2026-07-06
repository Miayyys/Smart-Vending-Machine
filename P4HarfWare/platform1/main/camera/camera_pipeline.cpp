#include "camera/camera_pipeline.h"
#include "config.h"
#include "camera/ppa_rotate.h"
#include "esp_log.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_video_init.h"
#include "esp_video_device.h"
#include "driver/ledc.h"
#include "driver/jpeg_encode.h"
#include "linux/videodev2.h"
#include <cstring>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <fcntl.h>

static const char *TAG = "cam_pipe";

// ── Construction / destruction ──────────────────────────────

CameraPipeline::~CameraPipeline()
{
    if (video_fd_ >= 0) {
        int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        ioctl(video_fd_, VIDIOC_STREAMOFF, &type);
        close(video_fd_);
    }
    if (jpeg_handle_) jpeg_del_encoder_engine(jpeg_handle_);
    if (jpeg_buf_)    free(jpeg_buf_);
    if (rot_buf_)     free(rot_buf_);
}

// ── Internal helpers ─────────────────────────────────────────

esp_err_t CameraPipeline::v4l2SetCtrl_(int fd, uint32_t id, int32_t value)
{
    v4l2_ext_controls ctrls{};
    v4l2_ext_control  ctrl{};
    ctrls.ctrl_class = V4L2_CTRL_CLASS_USER;
    ctrls.count = 1;
    ctrls.controls = &ctrl;
    ctrl.id = id;
    ctrl.value = value;
    return (ioctl(fd, VIDIOC_S_EXT_CTRLS, &ctrls) == 0) ? ESP_OK : ESP_FAIL;
}

esp_err_t CameraPipeline::xclkInit_()
{
    if (CAM_XCLK_PIN == GPIO_NUM_NC) return ESP_OK;

    ledc_timer_config_t tmr{};
    tmr.speed_mode     = LEDC_LOW_SPEED_MODE;
    tmr.duty_resolution = LEDC_TIMER_1_BIT;
    tmr.timer_num      = LEDC_TIMER_0;
    tmr.freq_hz        = CAM_XCLK_FREQ_HZ;
    tmr.clk_cfg        = LEDC_AUTO_CLK;
    ESP_RETURN_ON_ERROR(ledc_timer_config(&tmr), TAG, "ledc_timer_config");

    ledc_channel_config_t ch{};
    ch.gpio_num   = CAM_XCLK_PIN;
    ch.speed_mode = LEDC_LOW_SPEED_MODE;
    ch.channel    = LEDC_CHANNEL_0;
    ch.timer_sel  = LEDC_TIMER_0;
    ch.duty       = 1;
    ESP_RETURN_ON_ERROR(ledc_channel_config(&ch), TAG, "ledc_channel_config");
    ESP_LOGI(TAG, "XCLK on %d @ %d Hz", CAM_XCLK_PIN, CAM_XCLK_FREQ_HZ);
    return ESP_OK;
}

esp_err_t CameraPipeline::jpegEncoderInit_()
{
    jpeg_encode_engine_cfg_t eng{};
    eng.timeout_ms = 5000;
    ESP_RETURN_ON_ERROR(jpeg_new_encoder_engine(&eng, &jpeg_handle_),
                        TAG, "jpeg_new_encoder_engine");

    jpeg_encode_memory_alloc_cfg_t alloc{};
    alloc.buffer_direction = JPEG_ENC_ALLOC_OUTPUT_BUFFER;
    jpeg_buf_ = static_cast<uint8_t *>(
        jpeg_alloc_encoder_mem(JPEG_COMPACT, &alloc, &jpeg_buf_size_));
    ESP_RETURN_ON_FALSE(jpeg_buf_, ESP_ERR_NO_MEM, TAG, "jpeg_alloc");
    ESP_LOGI(TAG, "JPEG buffer: %zu bytes", jpeg_buf_size_);
    return ESP_OK;
}

// ── Public API ───────────────────────────────────────────────

esp_err_t CameraPipeline::init()
{
    ESP_RETURN_ON_ERROR(xclkInit_(), TAG, "xclk");

    // Sensor + CSI
    esp_video_init_csi_config_t csi[] = {{
        .sccb_config = {
            .init_sccb = true,
            .i2c_config = { .port = 0, .scl_pin = CAM_I2C_SCL_PIN, .sda_pin = CAM_I2C_SDA_PIN },
            .freq = CAM_I2C_FREQ_HZ,
        },
        .reset_pin = CAM_RESET_PIN,
        .pwdn_pin  = CAM_PWDN_PIN,
    }};
    esp_video_init_config_t cam_cfg{};
    cam_cfg.csi = csi;
    ESP_RETURN_ON_ERROR(esp_video_init(&cam_cfg), TAG, "esp_video_init");

    video_fd_ = open(ESP_VIDEO_MIPI_CSI_DEVICE_NAME, O_RDWR);
    if (video_fd_ < 0) {
        ESP_LOGE(TAG, "open %s failed", ESP_VIDEO_MIPI_CSI_DEVICE_NAME);
        return ESP_FAIL;
    }

    // Format negotiation
    v4l2_format fmt{};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ioctl(video_fd_, VIDIOC_G_FMT, &fmt);
    fmt.fmt.pix.width  = CAM_WIDTH;
    fmt.fmt.pix.height = CAM_HEIGHT;
    if constexpr (CAM_USE_ISP) {
        fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_RGB565;
    }
    if (ioctl(video_fd_, VIDIOC_S_FMT, &fmt) != 0) {
        ESP_LOGW(TAG, "Preferred fmt rejected, trying RAW8…");
        fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_SBGGR8;
        if (ioctl(video_fd_, VIDIOC_S_FMT, &fmt) != 0) {
            ESP_LOGE(TAG, "RAW8 S_FMT also failed");
            return ESP_FAIL;
        }
    }

    frame_w_       = fmt.fmt.pix.width;
    frame_h_       = fmt.fmt.pix.height;
    pixelformat_   = fmt.fmt.pix.pixelformat;
    frame_buf_size_ = fmt.fmt.pix.sizeimage;
    if (frame_buf_size_ == 0) {
        if      (pixelformat_ == V4L2_PIX_FMT_RGB565)  frame_buf_size_ = frame_w_ * frame_h_ * 2;
        else if (pixelformat_ == V4L2_PIX_FMT_SBGGR10) frame_buf_size_ = frame_w_ * frame_h_ * 5 / 4;
        else                                            frame_buf_size_ = frame_w_ * frame_h_;
    }

    auto fmt_name = (pixelformat_ == V4L2_PIX_FMT_RGB565) ? "RGB565"
                   : (pixelformat_ == V4L2_PIX_FMT_SBGGR10) ? "RAW10" : "RAW8";
    ESP_LOGI(TAG, "Capture: %" PRIu32 "x%" PRIu32 " %s (buf=%" PRIu32 ")",
             frame_w_, frame_h_, fmt_name, frame_buf_size_);

    v4l2SetCtrl_(video_fd_, V4L2_CID_VFLIP, 0);
    v4l2SetCtrl_(video_fd_, V4L2_CID_HFLIP, 0);

    // MMAP buffers
    v4l2_requestbuffers req{};
    req.count = 2;
    req.type  = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    if (ioctl(video_fd_, VIDIOC_REQBUFS, &req) != 0) {
        ESP_LOGE(TAG, "REQBUFS failed");
        return ESP_FAIL;
    }
    for (auto &buf : frame_bufs_) {
        v4l2_buffer vb{};
        vb.type   = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        vb.memory = V4L2_MEMORY_MMAP;
        vb.index  = int(&buf - frame_bufs_);
        ioctl(video_fd_, VIDIOC_QUERYBUF, &vb);
        buf = static_cast<uint8_t *>(mmap(nullptr, vb.length,
                     PROT_READ | PROT_WRITE, MAP_SHARED, video_fd_, vb.m.offset));
        ioctl(video_fd_, VIDIOC_QBUF, &vb);
    }

    // Start stream
    int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ioctl(video_fd_, VIDIOC_STREAMON, &type);

    // ISP warm-up
    ESP_LOGI(TAG, "ISP warming up…");
    for (int i = 0; i < 10; ++i) {
        v4l2_buffer vb{};
        vb.type   = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        vb.memory = V4L2_MEMORY_MMAP;
        if (ioctl(video_fd_, VIDIOC_DQBUF, &vb) == 0)
            ioctl(video_fd_, VIDIOC_QBUF, &vb);
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    ESP_LOGI(TAG, "ISP warmup done");

    // JPEG encoder + PPA
    if (pixelformat_ == V4L2_PIX_FMT_RGB565) {
        ESP_RETURN_ON_ERROR(jpegEncoderInit_(), TAG, "jpegEncoderInit");
        ESP_RETURN_ON_ERROR(ppa::init(), TAG, "ppa::init");

        rot_w_ = frame_h_;
        rot_h_ = frame_w_;
        uint32_t sz = (rot_w_ * rot_h_ * 2 + 127) & ~127u;
        rot_buf_ = static_cast<uint8_t *>(
            heap_caps_aligned_calloc(128, 1, sz, MALLOC_CAP_SPIRAM));
        ESP_RETURN_ON_FALSE(rot_buf_, ESP_ERR_NO_MEM, TAG, "rot_buf alloc");
        ESP_LOGI(TAG, "PPA: %" PRIu32 "x%" PRIu32 " → %" PRIu32 "x%" PRIu32,
                 frame_w_, frame_h_, rot_w_, rot_h_);
    }

    return ESP_OK;
}

esp_err_t CameraPipeline::captureJpeg(uint8_t **jpeg_out, size_t *jpeg_len)
{
    if (video_fd_ < 0) return ESP_FAIL;

    // Flush one stale frame so the next DQBUF returns a fresh one
    {
        v4l2_buffer vb{};
        vb.type   = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        vb.memory = V4L2_MEMORY_MMAP;
        if (ioctl(video_fd_, VIDIOC_DQBUF, &vb) == 0)
            ioctl(video_fd_, VIDIOC_QBUF, &vb);
    }

    v4l2_buffer vb{};
    vb.type   = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    vb.memory = V4L2_MEMORY_MMAP;
    if (ioctl(video_fd_, VIDIOC_DQBUF, &vb) != 0) {
        ESP_LOGE(TAG, "DQBUF failed");
        return ESP_FAIL;
    }
    auto *frame = frame_bufs_[vb.index];

    auto do_jpeg = [&](uint8_t *src, uint32_t w, uint32_t h) -> esp_err_t {
        jpeg_encode_cfg_t enc{};
        enc.src_type      = JPEG_ENCODE_IN_FORMAT_RGB565;
        enc.sub_sample    = JPEG_DOWN_SAMPLING_YUV422;
        enc.image_quality = JPEG_QUALITY;
        enc.width         = w;
        enc.height        = h;
        uint32_t out_len = 0;
        auto ret = jpeg_encoder_process(jpeg_handle_, &enc, src,
                                         w * h * 2, jpeg_buf_, jpeg_buf_size_, &out_len);
        if (ret == ESP_OK && out_len > 0) {
            last_jpeg_len_ = out_len;
            *jpeg_out = static_cast<uint8_t *>(malloc(out_len));
            if (*jpeg_out) {
                memcpy(*jpeg_out, jpeg_buf_, out_len);
                *jpeg_len = out_len;
            } else {
                ret = ESP_ERR_NO_MEM;
            }
        }
        return ret;
    };

    esp_err_t ret = ESP_FAIL;
    if (pixelformat_ == V4L2_PIX_FMT_RGB565 && rot_buf_) {
        uint32_t jpeg_w, jpeg_h;
        ret = ppa::rotate(frame, frame_w_, frame_h_,
                          rot_buf_, &jpeg_w, &jpeg_h, 2);
        if (ret == ESP_OK)
            ret = do_jpeg(rot_buf_, jpeg_w, jpeg_h);
    } else if (pixelformat_ == V4L2_PIX_FMT_RGB565) {
        ret = do_jpeg(frame, frame_w_, frame_h_);
    } else {
        *jpeg_out = static_cast<uint8_t *>(malloc(vb.bytesused));
        if (*jpeg_out) {
            memcpy(*jpeg_out, frame, vb.bytesused);
            *jpeg_len = vb.bytesused;
            ret = ESP_OK;
        }
    }

    ioctl(video_fd_, VIDIOC_QBUF, &vb);
    return (*jpeg_out && *jpeg_len > 0) ? ret : ESP_FAIL;
}

esp_err_t CameraPipeline::captureRawRgb565(uint8_t *out, uint32_t *w, uint32_t *h)
{
    if (video_fd_ < 0 || pixelformat_ != V4L2_PIX_FMT_RGB565)
        return ESP_FAIL;

    // Flush stale frame
    {
        v4l2_buffer vb{};
        vb.type   = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        vb.memory = V4L2_MEMORY_MMAP;
        if (ioctl(video_fd_, VIDIOC_DQBUF, &vb) == 0)
            ioctl(video_fd_, VIDIOC_QBUF, &vb);
    }

    v4l2_buffer vb{};
    vb.type   = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    vb.memory = V4L2_MEMORY_MMAP;
    if (ioctl(video_fd_, VIDIOC_DQBUF, &vb) != 0)
        return ESP_FAIL;

    auto *frame = frame_bufs_[vb.index];
    memcpy(out, frame, frame_w_ * frame_h_ * 2);
    *w = frame_w_;
    *h = frame_h_;

    ioctl(video_fd_, VIDIOC_QBUF, &vb);
    return ESP_OK;
}

esp_err_t CameraPipeline::getLastJpeg(const uint8_t **buf, size_t *len) const
{
    if (!jpeg_buf_ || last_jpeg_len_ == 0) return ESP_FAIL;
    *buf = jpeg_buf_;
    *len = last_jpeg_len_;
    return ESP_OK;
}
