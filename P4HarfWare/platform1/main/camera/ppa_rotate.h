#ifndef PPA_ROTATE_H
#define PPA_ROTATE_H

#include <cstdint>
#include "esp_err.h"

namespace ppa {

/**
 * @brief Initialize the PPA SRM (Scale-Rotate-Mirror) engine.
 */
esp_err_t init();

/**
 * @brief Rotate + mirror an RGB image using PPA hardware.
 * @return ESP_OK on success.
 */
esp_err_t rotate(const uint8_t *src, uint32_t src_w, uint32_t src_h,
                 uint8_t *dst, uint32_t *dst_w, uint32_t *dst_h,
                 uint32_t pixel_size);

}  // namespace ppa

#endif  // PPA_ROTATE_H
