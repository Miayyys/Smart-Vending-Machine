# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Smart Vending Machine — an ESP32-P4 based retail cabinet with on-device YOLO object recognition. The hardware captures photos on door open/close, runs local inference to identify products, and reports results to a cloud server for settlement.

## Repo structure

| Directory | Purpose |
|---|---|
| `P4HarfWare/platform1/` | ESP32-P4 firmware (ESP-IDF v5.4+ project) |
| `P4Yolo/model3kind/` | YOLO11n training artifacts — 3-class model (nongfu, runtian, soda) |
| `P4Yolo/model4kind/` | YOLO11n training artifacts — 4-class model (+ yogurt) |
| `SVM-Server/` | Cloud backend (Docker, MQTT + HTTPS) — currently stub |
| `doc/` | Chinese-language feature documentation |

## Build commands

```bash
# Activate ESP-IDF environment first
. ~/esp/esp-idf/export.sh

# Build from platform1/
cd P4HarfWare/platform1
idf.py build

# Flash to device (UART) + monitor
idf.py flash monitor

# Flash to a specific port
idf.py -p /dev/ttyUSB0 flash monitor
```

Target: `esp32p4` (Waveshare ESP32-P4 Module). The SDK config uses pre-v3 engineering sample settings — CPU 360 MHz max, QIO flash mode, 16MB flash.

## Architecture (P4HarfWare firmware)

### Init order (`main.cpp`)
1. NVS flash init
2. WiFi + MQTT (blocks until connected)
3. Camera pipeline (OV5647 MIPI → ISP → PPA rotate → JPEG)
4. Cabinet state machine (passes MQTT + camera singletons)
5. YOLO model load from flash partition
6. Door sensor (GPIO interrupt-driven)
7. Serial console REPL

Everything after init is **event-driven** — the idle loop does nothing.

### Event bus (`main/bus/`)

All modules communicate through the default `esp_event` loop base `APP_BUS`. Events carry lightweight metadata; bulk data (JPEG frames) stays in the producing module's internal buffer with zero-copy descriptors.

Key event IDs:
- Ingress: `APP_EVT_DOOR_OPENED/CLOSED`, `APP_EVT_CMD_UNLOCK/LOCK/REBOOT/SYNC/OTA`
- Internal flow: `APP_EVT_PHOTO_READY`, `APP_EVT_UPLOAD_DONE`
- State: `APP_EVT_STATE_CHANGED`, `APP_EVT_ERROR_CLEAR`

### State machine (`state_machine.cpp`)

```
CABINET_LOCKED → CABINET_UNLOCKED → CABINET_DOOR_OPEN → CABINET_ANALYZING → CABINET_LOCKED
                                              ↕                    ↑
                                        CABINET_ERROR ←────────────┘
```

- **LOCKED**: servo engaged, door sensor ignored
- **UNLOCKED**: waiting for door to open (auto-locks after 30s timeout)
- **DOOR_OPEN**: door is open, photo cycle triggered on entry. Door-open timeout (60s) triggers anomaly warning
- **ANALYZING**: capture → YOLO inference → HTTPS upload → MQTT report
- **ERROR**: anomaly detected (door mismatch, camera fail, long-open, server-triggered). Auto-clears after 5s, restores previous state

The heavy work (capture + YOLO + upload) runs in a dedicated `work_task` (FreeRTOS task). Door events arriving while busy are queued with a 15s TTL.

### Camera pipeline (`main/camera/`)

`CameraPipeline` class: OV5647 MIPI RAW8 → ISP (color processing) → RGB565 → PPA rotate (90° software rotation) → JPEG encode. Captured JPEG is heap-allocated; caller must `free()`. Also supports raw RGB565 capture for YOLO input.

### YOLO inference (`main/yolo/`)

ESP-DL library with INT8-quantized YOLO11n model. Input: 320×320 RGB565. Output: bounding boxes with class ID and confidence score. The `.espdl` model file is flashed to a dedicated `model_0`/`model_1` partition (dual-slot OTA). `model_otadata` partition tracks the active slot.

Label mapping: `2→soda, 6→nongfu, 7→runtian, 8→yogurt`.

### Network (`main/network/`)

`WifiMqtt` class: RAII WiFi STA + MQTT client. Constructed with a callback that dispatches incoming MQTT commands to the event bus. Uses ESP32-C6 as WiFi co-processor. HTTPS uploads go to `SERVER_HOST:443` with Basic auth and embedded self-signed cert (`server_cert.pem`).

MQTT topics follow `retail/{DEVICE_ID}/event/{detect,anomaly,ota_progress}` and `retail/{DEVICE_ID}/telemetry/weight`.

### OTA (`state_machine.cpp`)

Two OTA paths:
- **Firmware OTA**: dual-slot `app_0`/`app_1` via standard ESP-IDF OTA API. Downloads HTTPS → writes to inactive partition → switches boot partition → reboots
- **Model OTA**: dual-slot `model_0`/`model_1`. Downloads HTTPS → erases inactive slot → writes → updates `model_otadata` flag → reboots. `yolo_init()` reads the flag to load from the correct slot

### Hardware config (`config.h`)

All pin assignments, thresholds, and tuning parameters live in `config.h`. GPIO2 for door magnet (pull-up, low=closed), GPIO22 for SG90 servo (50Hz PWM), GPIO6/21/20 for RGB LED (common anode). Feature toggles: `DOOR_GPIO_ENABLED`, `WEIGHT_SENSOR_ENABLED`, `PRICE_DISPLAY_ENABLED`.

### ESP-DL dependency

The build depends on ESP-DL installed at the path specified in `CMakeLists.txt` `EXTRA_COMPONENT_DIRS`. This is the official Espressif deep learning library providing `dl::Model`, `ImagePreprocessor`, and `yolo11PostProcessor`.

### Partition layout (16MB flash)

| Partition | Size | Purpose |
|---|---|---|
| app_0 | ~4MB | Firmware slot A |
| app_1 | ~4MB | Firmware slot B |
| model_0 | ~4MB | YOLO model slot A |
| model_1 | ~4MB | YOLO model slot B |
| model_otadata | 4KB | Active model slot flag |

## YOLO model training (P4Yolo)

Training uses Ultralytics YOLO11. The `.onnx` model is exported then converted to ESP-DL `.espdl` format with INT8 quantization for ESP32-P4. Model names encode input size and target (e.g., `best_320_esp32p4_8bit.espdl` = 320×320, ESP32-P4, INT8).
