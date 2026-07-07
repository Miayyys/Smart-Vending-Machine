#include "yolo/yolo_detect.h"
#include "config.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_partition.h"
#include "dl_model_base.hpp"
#include "dl_image_preprocessor.hpp"
#include "dl_detect_yolo11_postprocessor.hpp"
#include <list>
#include <cstring>
#include <cmath>
#include <cstdio>
#include <new>

static const char *TAG = "yolo";
static dl::Model *s_model = nullptr;
static dl::image::ImagePreprocessor *s_pre = nullptr;
static dl::detect::yolo11PostProcessor *s_post = nullptr;

// ── 模型槽切换 ──────────────────────────────────────────────
// model_otadata 分区(0x40)存储当前激活槽：0xFF/0=model_0, 1=model_1
#define MODEL_OTADATA_TYPE ((esp_partition_subtype_t)0x40)
#define MODEL_0_TYPE       ((esp_partition_subtype_t)0x41)
#define MODEL_1_TYPE       ((esp_partition_subtype_t)0x42)

static int get_active_model_slot(void)
{
    const esp_partition_t *pt = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, MODEL_OTADATA_TYPE, "model_otadata");
    if (!pt) return 0;
    uint8_t flag = 0xFF;
    esp_partition_read(pt, 0, &flag, 1);
    return (flag == 1) ? 1 : 0;
}

static const char *model_slot_name(int slot)
{
    return (slot == 0) ? "model_0" : "model_1";
}

static esp_partition_subtype_t model_slot_type(int slot)
{
    return (slot == 0) ? MODEL_0_TYPE : MODEL_1_TYPE;
}

extern "C" void model_otadata_mark_active(int slot)
{
    const esp_partition_t *pt = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, MODEL_OTADATA_TYPE, "model_otadata");
    if (!pt) return;
    uint8_t flag = (slot == 1) ? 1 : 0;
    esp_partition_erase_range(pt, 0, pt->size);
    esp_partition_write(pt, 0, &flag, 1);
}

extern "C" esp_err_t yolo_init(void)
{
    if (s_model) { delete s_model; s_model = nullptr; }
    if (s_pre)   { delete s_pre;   s_pre = nullptr; }
    if (s_post)  { delete s_post;  s_post = nullptr; }

    // 读取激活槽
    int slot = get_active_model_slot();
    const char *part_name = model_slot_name(slot);
    ESP_LOGI(TAG, "active slot=%d (%s)", slot, part_name);

    // 预检分区
    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, model_slot_type(slot), part_name);
    if (!part) { ESP_LOGE(TAG, "%s not found", part_name); return ESP_FAIL; }
    uint8_t magic[4];
    if (esp_partition_read(part, 0, magic, 4) != ESP_OK) {
        ESP_LOGE(TAG, "%s read failed", part_name); return ESP_FAIL;
    }
    if (magic[0] == 0xFF && magic[1] == 0xFF && magic[2] == 0xFF && magic[3] == 0xFF) {
        ESP_LOGE(TAG, "%s is empty", part_name); return ESP_FAIL;
    }
    ESP_LOGI(TAG, "%s: 0x%lx +%ld magic=%02x%02x%02x%02x",
             part_name, (long)part->address, (long)part->size,
             magic[0], magic[1], magic[2], magic[3]);

    s_model = new (std::nothrow) dl::Model(part_name, fbs::MODEL_LOCATION_IN_FLASH_PARTITION,
                            0, dl::MEMORY_MANAGER_GREEDY, nullptr, false);
    if (!s_model) { ESP_LOGE(TAG, "Model allocation failed"); return ESP_FAIL; }
    s_model->minimize();

    auto *in = s_model->get_input();
    if (!in) { ESP_LOGE(TAG, "get_input failed"); return ESP_FAIL; }
    auto shp = in->get_shape();
    ESP_LOGI(TAG, "model input: [%d,%d,%d,%d] dtype=%s size=%d exp=%d",
             shp[0], shp[1], shp[2], shp[3],
             in->get_dtype_string(), in->get_size(), (int)in->exponent);

    auto outs = s_model->get_outputs();
    ESP_LOGI(TAG, "model has %d output(s):", (int)outs.size());
    int oi = 0;
    for (auto &kv : outs) {
        auto o = kv.second;
        auto os = o->get_shape();
        ESP_LOGI(TAG, "  out[%d] name=\"%s\" shape=[%d,%d,%d,%d] dtype=%s",
                 oi, kv.first.c_str(),
                 os.size() > 0 ? os[0] : -1,
                 os.size() > 1 ? os[1] : -1,
                 os.size() > 2 ? os[2] : -1,
                 os.size() > 3 ? os[3] : -1,
                 o->get_dtype_string());
        ++oi;
    }

    // ESP-DL official preprocessor: mean=0, std=255, letterbox (matches coco_detect).
    s_pre = new dl::image::ImagePreprocessor(s_model, {0.f, 0.f, 0.f}, {255.f, 255.f, 255.f});
    s_pre->enable_letterbox({114, 114, 114});

    // Official yolo11 postprocessor. 320x320 → stages {{8,8,4,4},{16,16,8,8},{32,32,16,16}}.
    // Reads box0/score0/box1/score1/box2/score2 internally; score thr compared in quant domain.
    s_post = new dl::detect::yolo11PostProcessor(
        s_model, s_pre, YOLO_SCORE_THR, YOLO_NMS_THR, 10,
        {{8, 8, 4, 4}, {16, 16, 8, 8}, {32, 32, 16, 16}});
    return ESP_OK;
}

extern "C" bool yolo_is_ready(void) { return s_model != nullptr; }

/**
 * @brief 验证指定槽的 .espdl 模型能否被 dl::Model 成功加载。
 * 只做尝试性加载并立即释放，不替换当前活跃模型 (s_model/s_pre/s_post 不受影响)。
 * @return ESP_OK 模型可加载; ESP_FAIL 不可加载 (分区空/格式错/模型不兼容)
 */
extern "C" esp_err_t yolo_verify_slot(int slot)
{
    if (slot < 0 || slot > 1) return ESP_FAIL;
    const char *part_name = (slot == 0) ? "model_0" : "model_1";
    esp_partition_subtype_t stype = (slot == 0) ? MODEL_0_TYPE : MODEL_1_TYPE;

    const esp_partition_t *part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, stype, part_name);
    if (!part) { ESP_LOGE(TAG, "verify: %s not found", part_name); return ESP_FAIL; }

    // 快速空分区检查
    uint8_t magic[4];
    if (esp_partition_read(part, 0, magic, 4) != ESP_OK) {
        ESP_LOGE(TAG, "verify: %s read failed", part_name); return ESP_FAIL;
    }
    if (magic[0] == 0xFF && magic[1] == 0xFF && magic[2] == 0xFF && magic[3] == 0xFF) {
        ESP_LOGE(TAG, "verify: %s is empty", part_name); return ESP_FAIL;
    }

    // 独立加载验证, 不动全局 s_model
    auto *trial = new (std::nothrow) dl::Model(part_name,
        fbs::MODEL_LOCATION_IN_FLASH_PARTITION, 0,
        dl::MEMORY_MANAGER_GREEDY, nullptr, false);
    if (!trial) { ESP_LOGE(TAG, "verify: %s alloc failed", part_name); return ESP_FAIL; }

    trial->minimize();
    auto *in = trial->get_input();
    esp_err_t ret = (in && in->get_size() > 0) ? ESP_OK : ESP_FAIL;
    if (ret != ESP_OK) ESP_LOGE(TAG, "verify: %s failed to get input", part_name);

    delete trial;
    return ret;
}

// ── Public API ──────────────────────────────────────────────

extern "C" esp_err_t yolo_detect(uint8_t *rgb565, int width, int height,
                                  yolo_result_t *out)
{
    if (!s_model || !s_pre || !s_post || !rgb565 || !out) return ESP_ERR_INVALID_STATE;
    out->items = nullptr; out->count = 0;

    // Step 1: preprocess (resize + quantize + letterbox) into the model's input tensor
    dl::image::img_t img{
        .data = rgb565,
        .width = (uint16_t)width,
        .height = (uint16_t)height,
        .pix_type = dl::image::DL_IMAGE_PIX_TYPE_RGB565LE,
    };
    s_pre->preprocess(img);

    // Step 2: inference
    s_model->run();

    // Step 3: official postprocess (DFL decode + quant-domain score thr + NMS)
    s_post->clear_result();
    s_post->postprocess();
    auto &results = s_post->get_result(width, height);

    if (results.empty()) return ESP_OK;

    // result_t.box = [left, top, right, bottom] → convert to [x, y, w, h]
    out->count = results.size();
    out->items = (yolo_detection_t *)malloc(out->count * sizeof(yolo_detection_t));
    if (!out->items) { out->count = 0; return ESP_ERR_NO_MEM; }
    int i = 0;
    for (auto &r : results) {
        out->items[i].label_id = r.category;
        out->items[i].score = r.score;
        out->items[i].x = r.box[0];
        out->items[i].y = r.box[1];
        out->items[i].w = r.box[2] - r.box[0];
        out->items[i].h = r.box[3] - r.box[1];
        ESP_LOGI(TAG, "Obj %d: cls=%d score=%.2f box=[%d,%d,%d,%d]",
                 i, out->items[i].label_id, out->items[i].score,
                 out->items[i].x, out->items[i].y, out->items[i].w, out->items[i].h);
        ++i;
    }
    return ESP_OK;
}
