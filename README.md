# 校园智能售货机 (Smart Vending Machine)

基于 ESP32-P4 的边缘 AI 无人零售系统。用户在手机端扫码开门、选取商品、关门即自动结算——YOLO 视觉识别在设备本地完成，无需上传图片到云端推理。

## 架构

```
手机小程序 ──▶ 云服务器 (Docker) ──▶ ESP32-P4 智能柜
 微信小程序      Spring Boot + EMQX      端侧 YOLO11n 识别
               MySQL + ONNX 推理        OV5647 摄像头 + 门磁 + 舵机
```

## 项目特色

**端侧 AI，离线可用。** YOLO11n 模型经 INT8 量化后运行在 ESP32-P4 上，单次推理完成柜内商品识别。图片不离开设备，无需 GPU 服务器，大幅降低运维成本。

**双槽 OTA，无感升级。** 固件和 AI 模型各占独立双槽分区。新版本下载到备用槽，一键切换并重启。升级失败自动回退，模型可独立更新无需重新烧录固件。

**关门即结算。** 用户扫码开门→取走商品→关门，两次拍照+YOLO 识别取差值，自动生成订单。无需称重、无需 RFID 标签，纯视觉方案。

**多层异常检测。** 设备本地监控门磁异常、开门超时、摄像头故障；服务器端可选开启双模交叉验证（云端同步推理与端侧结果比对），不一致自动告警。

**完整的无人零售闭环。** 硬件终端 + 微信小程序 + Docker 服务器，三端代码完整开源，可直接部署运营。

## 目录结构

| 目录 | 说明 |
|------|------|
| `P4HarfWare/platform1/` | ESP32-P4 固件 (ESP-IDF v5.4, C++) |
| `P4Yolo/` | YOLO11n 模型训练脚本与数据 |
| `app/sx/` | 微信小程序 (用户端) |
| `SVM-Server/retail-cloud-staging/` | 服务器端 (Docker Compose) |
| `doc/` | 各端详细介绍文档 |

## 快速开始

### 硬件端

```bash
. ~/esp/esp-idf/export.sh
cd P4HarfWare/platform1
idf.py build && idf.py flash monitor
```

依赖 ESP-IDF v5.4 和 ESP-DL。构建前需在 `main/config.h` 中填入 WiFi、服务器地址和 MQTT 凭证。

### 服务器端

```bash
cd SVM-Server/retail-cloud-staging
docker compose up -d --build
```

首次启动后执行 `docker compose exec emqx sh /opt/emqx/init-users.sh` 启用 MQTT 鉴权。部署前需在 `.env` 中修改数据库密码。

### 手机端

使用微信开发者工具打开 `app/sx/` 目录。部署前需在 `app.js` 中修改服务器地址和 Basic Auth 凭证。

## 部署配置

**克隆后必须修改的配置项清单见 [`doc/部署配置清单.md`](doc/部署配置清单.md)**，包括服务器 IP、WiFi、MQTT 密码、OTA 密码等。

## 文档

| 文档 | 内容 |
|------|------|
| [doc/p4硬件平台.md](doc/p4硬件平台.md) | 硬件功能介绍、引脚、状态机、业务流程 |
| [doc/服务器端.md](doc/服务器端.md) | 服务架构、API、MQTT 消息体系、AI 推理 |
| [doc/小程序用户端.md](doc/小程序用户端.md) | 页面结构、购物流程、API 接口 |
| [doc/部署配置清单.md](doc/部署配置清单.md) | 部署前需修改的全部配置项 |
