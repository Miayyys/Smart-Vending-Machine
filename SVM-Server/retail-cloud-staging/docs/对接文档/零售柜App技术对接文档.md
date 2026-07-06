# 校园零售柜 — App 技术对接文档

> 服务器 `<server-ip>` · HTTPS · Basic Auth

---

## 一、API 根地址

```
https://<server-ip>/api
```

**所有接口（除拍照上传）都需要 HTTP Basic Auth：**

```
用户名: admin
密码: <nginx-basic-auth-password>
```

请求头：`Authorization: Basic <base64(admin:密码)>`

---

## 二、商品

### GET /api/products — 商品列表
返回：
```json
[
  {"id":2, "name":"汽水", "sku":"SKU-SODA", "price":3.50, "weightGram":330},
  {"id":6, "name":"农夫山泉", "sku":"SKU-NONGFU", "price":2.50, "weightGram":550},
  {"id":7, "name":"润田", "sku":"SKU-RUNTIAN", "price":1.50, "weightGram":550},
  {"id":8, "name":"酸奶", "sku":"SKU-YOGURT", "price":4.00, "weightGram":250}
]
```

### GET /api/products/{id} — 单个商品

### PUT /api/products/{id} — 更新商品（修改单价等）
请求：
```json
{"price": 3.00}
```

---

## 三、库存

### GET /api/devices/{deviceId}/stock — 某设备库存
例：`GET /api/devices/D01-F1/stock`
返回：
```json
[
  {"deviceId":"D01-F1","productId":2,"qty":5,"threshold":1,"updateTime":"2026-07-03T15:00:00"},
  {"deviceId":"D01-F1","productId":6,"qty":3,"threshold":1,"updateTime":"2026-07-03T15:00:00"},
  ...
]
```

### POST /api/stock/reconcile — 库存校准
参数（Query String）：`?deviceId=D01-F1&productId=6&qty=10&threshold=1`

---

## 四、订单

### GET /api/orders — 订单列表（最新在前）
可选 `?deviceId=D01-F1` 筛选。返回：
```json
[
  {
    "id": 325,
    "deviceId": "D01",
    "userId": null,
    "totalAmount": 8.00,
    "payStatus": "UNPAID",
    "createTime": "2026-07-03T10:26:57",
    "settleTime": null
  },
  ...
]
```

### GET /api/orders/{id}/items — 订单明细
返回：
```json
[
  {"id":38, "orderId":325, "productId":6, "qty":1, "price":2.50, "subtotal":2.50},
  {"id":39, "orderId":325, "productId":7, "qty":1, "price":1.50, "subtotal":1.50}
]
```

### POST /api/orders/{id}/update — 更新订单（结算/改用户）
请求：
```json
{"payStatus": "PAID", "userId": "张三"}
```
- 设 `payStatus=PAID` 时自动写入 `settleTime`
- 设 `userId` 更新用户标识

---

## 五、告警

### GET /api/alerts/restock?status=PENDING — 补货告警
可选 status：`PENDING` / `ACK` / 不传=全部。返回：
```json
[
  {
    "id": 13,
    "deviceId": "D01",
    "productId": 6,
    "curQty": 0,
    "threshold": 1,
    "status": "PENDING",
    "createTime": "2026-07-03T10:46:00",
    "ackTime": null
  },
  ...
]
```

### POST /api/alerts/restock/{id}/ack — 确认补货
无需 body，调后 status 变 ACK，写入 ackTime。

---

## 六、拍照记录

### GET /api/snapshot/search — 拍照列表
参数：`?deviceId=D01-F1&doorAction=CLOSE&limit=100`
返回：
```json
[
  {
    "id": 325,
    "deviceId": "D01-F1",
    "floor": 1,
    "doorAction": "OPEN",
    "fileName": "open_test.jpg",
    "fileSize": 87807,
    "md5": "56428bb91fbb7fa3acd9293737f522d7",
    "createTime": "2026-07-03T16:58:55",
    "detectionData": "{\"success\":true,\"counts\":{\"nongfu\":1,...},\"processed_ms\":44.7}",
    "detectedAt": "2026-07-03T16:59:00"
  },
  ...
]
```

### GET /api/snapshot/{id}/file — 原图
返回 JPEG 图片，可直接放 `<Image>` 的 src。需带 Basic Auth 头。

### POST /api/snapshot/upload — 上传图片（设备专用，免 Basic Auth）
```
Content-Type: multipart/form-data
字段:
  token        = "<snapshot-token-D01>"   // 设备Token
  deviceId     = "D01-F1"
  floor        = 1
  doorAction   = "OPEN" / "CLOSE" / "SYNC"
  file         = 图片文件
```

### DELETE /api/snapshot/{id} — 删除

---

## 七、MQTT 实时推送

```
连接地址: wss://<server-ip>/mqtt
用户名:   retail_ui
密码:     <mqtt-ui-password>
```

**订阅主题**：`retail/+/event/stock_detected`

```json
{
  "deviceId": "D01-F1",
  "doorAction": "CLOSE",
  "batchId": "uuid-xxx",
  "counts": {"nongfu": 0, "runtian": 0, "soda": 1, "yogurt": 0},
  "source": "device"
}
```

收到推送 → 刷新库存和订单列表。

---

## 八、设备列表

| 设备ID | 名称 | 说明 |
|--------|------|------|
| D01-F1 | 1号柜 | 唯一运营中的柜子 |

（只有一个柜子，单层单摄像头）

---

## 九、商品ID ↔ 模型标签

| productId | 名称 | 模型标签 | 置信度阈值 |
|-----------|------|----------|:----:|
| 2 | 汽水 | soda | 0.25 |
| 6 | 农夫山泉 | nongfu | 0.25 |
| 7 | 润田 | runtian | 0.25 |
| 8 | 酸奶 | yogurt | 0.60 |

---

## 十、业务逻辑说明

**方式一：设备端推理（MQTT）**
```
开门 → ESP32本地识别 → MQTT上报 OPEN + batch_id → 缓存count_before
关门 → ESP32本地识别 → MQTT上报 CLOSE + batch_id
  → diff = before - after → 生成订单 → 更新库存
  → 补货评估 → MQTT推送 stock_detected
```

**方式二：云端推理（HTTP 上传）**
```
开门拍照上传 → AI识别 → 记录，不动库存
关门拍照上传 → AI识别 → diff → 生成订单 → 更新库存
SYNC拍照上传 → 同关门逻辑
```

**补货规则**
- 柜总量 < threshold(1) → 建补货告警
- 柜总量 ≥ threshold → 自动 ACK 旧告警

---

## 十一、状态码约定

| HTTP | 含义 |
|------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | Basic Auth 失败（账号密码错） |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

---

> 所有接口均已生产运行，可直接调用测试。
