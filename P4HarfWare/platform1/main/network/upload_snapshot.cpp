/*
 * upload_snapshot.c — HTTP multipart POST to /api/snapshot/upload
 *
 * Builds full multipart body in heap (PSRAM), then uses
 * esp_http_client_set_post_field() + esp_http_client_perform().
 */
#include "network/upload_snapshot.h"
#include "config.h"
#include "esp_log.h"
#include "esp_http_client.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* Embedded self-signed server certificate for TLS pinning */
extern const char server_cert_pem_start[] asm("_binary_server_cert_pem_start");
extern const char server_cert_pem_end[]   asm("_binary_server_cert_pem_end");

static const char *TAG = "upload";

#define UPLOAD_URL_SCHEME   "https://"
#define UPLOAD_URL_PATH     "/api/snapshot/upload"

/* ── multipart body builder ───────────────────────────── */
#define BOUNDARY    "----ESP32P4SNAP"

/* Write a text form-data part into buf at offset, return new offset. */
static size_t write_text_part(char *buf, size_t off, const char *name,
                               const char *value)
{
    return off + sprintf(buf + off,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"%s\"\r\n"
        "\r\n"
        "%s\r\n", name, value);
}

/* Write the file part + final boundary, return new offset. */
static size_t write_file_part(char *buf, size_t off,
                               const uint8_t *jpeg, size_t jpeg_len)
{
    off += sprintf(buf + off,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"file\"; filename=\"snap.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n"
        "\r\n");
    memcpy(buf + off, jpeg, jpeg_len);
    off += jpeg_len;
    off += sprintf(buf + off, "\r\n--" BOUNDARY "--\r\n");
    return off;
}

esp_err_t upload_snapshot(const uint8_t *jpeg_buf, size_t jpeg_len,
                          const char *door_action)
{
    if (!jpeg_buf || !jpeg_len || !door_action) return ESP_ERR_INVALID_ARG;

    /* floor value as string */
    char floor_str[8];
    snprintf(floor_str, sizeof(floor_str), "%d", DEVICE_FLOOR);

    /* ── compute exact total body size ──                 */
    /* snprintf(dst, 0, ...) returns the size that would be written (C99) */
    int total = 0;

    /* token */
    total += snprintf(NULL, 0,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"token\"\r\n"
        "\r\n"
        "%s\r\n", SNAP_TOKEN);
    /* deviceId */
    total += snprintf(NULL, 0,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"deviceId\"\r\n"
        "\r\n"
        "%s\r\n", DEVICE_ID);
    /* floor */
    total += snprintf(NULL, 0,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"floor\"\r\n"
        "\r\n"
        "%s\r\n", floor_str);
    /* doorAction */
    total += snprintf(NULL, 0,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"doorAction\"\r\n"
        "\r\n"
        "%s\r\n", door_action);
    /* file header */
    total += snprintf(NULL, 0,
        "--" BOUNDARY "\r\n"
        "Content-Disposition: form-data; name=\"file\"; filename=\"snap.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n"
        "\r\n");
    /* raw JPEG data */
    total += (int)jpeg_len;
    /* trailing boundary */
    total += snprintf(NULL, 0, "\r\n--" BOUNDARY "--\r\n");

    /* ── allocate body buffer ──                          */
    char *body = (char *)malloc(total);
    if (!body) {
        ESP_LOGE(TAG, "malloc %d bytes failed", total);
        return ESP_ERR_NO_MEM;
    }

    /* ── build multipart body ──                          */
    size_t off = 0;
    off = write_text_part(body, off, "token", SNAP_TOKEN);
    off = write_text_part(body, off, "deviceId", DEVICE_ID);
    off = write_text_part(body, off, "floor", floor_str);
    off = write_text_part(body, off, "doorAction", door_action);
    off = write_file_part(body, off, jpeg_buf, jpeg_len);
    /* off should now equal total */

    /* ── HTTP client config ──                            */
    esp_http_client_config_t http_cfg;
    memset(&http_cfg, 0, sizeof(http_cfg));
    char snap_url[256];
    snprintf(snap_url, sizeof(snap_url), "%s%s%s",
             UPLOAD_URL_SCHEME, SERVER_HOST, UPLOAD_URL_PATH);
    http_cfg.url                          = snap_url;
    http_cfg.method                       = HTTP_METHOD_POST;
    http_cfg.timeout_ms                   = 15000;
    http_cfg.skip_cert_common_name_check  = true;
    http_cfg.cert_pem                     = server_cert_pem_start;
    http_cfg.cert_len                     = (size_t)(server_cert_pem_end - server_cert_pem_start);
    http_cfg.keep_alive_enable            = false;
    esp_http_client_handle_t client = esp_http_client_init(&http_cfg);
    if (!client) {
        ESP_LOGE(TAG, "http_client_init failed");
        free(body);
        return ESP_FAIL;
    }

    /* ── set body and perform ──                         */
    esp_http_client_set_post_field(client, body, total);

    /* Override Content-Type (default is application/x-www-form-urlencoded) */
    esp_http_client_set_header(client, "Content-Type",
        "multipart/form-data; boundary=" BOUNDARY);

    /* Content-Length is set automatically by perform() from post_len */

    esp_err_t ret = esp_http_client_perform(client);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "perform failed: %s", esp_err_to_name(ret));
        esp_http_client_cleanup(client);
        free(body);
        return ret;
    }

    /* ── response ──                                      */
    int status_code = esp_http_client_get_status_code(client);
    int content_length = esp_http_client_get_content_length(client);
    ESP_LOGI(TAG, "Upload HTTP %d, body=%d bytes", status_code, content_length);

    if (status_code == 200) {
        char resp[256] = {0};
        esp_http_client_read(client, resp, sizeof(resp) - 1);
        ESP_LOGI(TAG, "Upload OK: %s", resp);
        ret = ESP_OK;
    } else {
        char err[256] = {0};
        esp_http_client_read(client, err, sizeof(err) - 1);
        ESP_LOGW(TAG, "Upload failed, HTTP %d: %s", status_code, err);
        ret = ESP_FAIL;
    }

    esp_http_client_cleanup(client);
    free(body);
    return ret;
}
