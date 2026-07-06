#include "camera/ppa_rotate.h"
#include "esp_log.h"
#include "esp_check.h"
#include "esp_private/esp_cache_private.h"
#include "driver/ppa.h"
#include <cstring>

static const char *TAG = "ppa_rot";

namespace {
ppa_client_handle_t s_ppa_handle = nullptr;
}

namespace ppa {

esp_err_t init()
{
    ppa_client_config_t cfg{};
    cfg.oper_type = PPA_OPERATION_SRM;
    ESP_RETURN_ON_ERROR(ppa_register_client(&cfg, &s_ppa_handle),
                        TAG, "ppa_register_client failed");

    size_t cache_line{};
    ESP_RETURN_ON_ERROR(esp_cache_get_alignment(MALLOC_CAP_SPIRAM, &cache_line),
                        TAG, "esp_cache_get_alignment failed");
    ESP_LOGI(TAG, "PPA rotation engine ready (cache line %zu)", cache_line);
    return ESP_OK;
}

esp_err_t rotate(const uint8_t *src, uint32_t src_w, uint32_t src_h,
                 uint8_t *dst, uint32_t *dst_w, uint32_t *dst_h,
                 uint32_t pixel_size)
{
    *dst_w = src_h;
    *dst_h = src_w;

    const auto cm = (pixel_size == 2)
        ? PPA_SRM_COLOR_MODE_RGB565
        : PPA_SRM_COLOR_MODE_RGB888;

    uint32_t buf_size = (*dst_w) * (*dst_h) * pixel_size;
    buf_size = (buf_size + 127) & ~127u;  // 128B cache-line alignment

    ppa_srm_oper_config_t cfg{};
    cfg.in.buffer       = src;
    cfg.in.pic_w        = src_w;
    cfg.in.pic_h        = src_h;
    cfg.in.block_w      = src_w;
    cfg.in.block_h      = src_h;
    cfg.in.srm_cm       = cm;

    cfg.out.buffer      = dst;
    cfg.out.buffer_size = buf_size;
    cfg.out.pic_w       = *dst_w;
    cfg.out.pic_h       = *dst_h;
    cfg.out.srm_cm      = cm;

    cfg.rotation_angle  = PPA_SRM_ROTATION_ANGLE_0;
    cfg.scale_x         = 1;
    cfg.scale_y         = 1;
    cfg.mirror_x        = 1;
    cfg.mode            = PPA_TRANS_MODE_BLOCKING;

    return ppa_do_scale_rotate_mirror(s_ppa_handle, &cfg);
}

}  // namespace ppa
