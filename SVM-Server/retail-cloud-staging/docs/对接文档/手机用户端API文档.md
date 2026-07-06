# 校园零售柜 — 手机用户端 API 文档

> 服务器 `<server-ip>` · HTTP 直连（无 HTTPS） · 免鉴权 · 端口 80

---

## 一、业务流程

```
手机端                     服务器                     ESP32
  │                         │                         │
  │──① 查看商品列表────────→│                         │
  │←── 返回商品+价格───────│                         │
  │                         │                         │
  │──② 开门请求───────────→│                         │
  │                         │──MQTT cmd/unlock───────→│ 开门
  │←── 返回 batch_id───────│                         │
  │                         │                         │
  │                                 （用户拿取商品）      │
  │                         │                         │
  │                         │←──MQTT detect OPEN─────│ 拍照识别
  │                         │←──MQTT detect CLOSE────│ 拍照识别
  │                         │                         │
  │                         │──diff计算→生成订单       │
  │                         │                         │
  │──③ 查询订单(batch_id)→│                         │
  │←── 返回订单明细────────│                         │
```

---

## 二、API 接口

> 移动端接口 **无鉴权**，直接 HTTP 访问

### 2.1 商品列表

```
GET /api/mobile/products
```

返回：
```json
[
  {"id":2, "name":"汽水", "price":3.50, "sku":"SKU-SODA", "imageUrl":null},
  {"id":6, "name":"农夫山泉", "price":2.50, "sku":"SKU-NONGFU", "imageUrl":null},
  {"id":7, "name":"润田", "price":1.50, "sku":"SKU-RUNTIAN", "imageUrl":null},
  {"id":8, "name":"酸奶", "price":4.00, "sku":"SKU-YOGURT", "imageUrl":null}
]
```

### 2.2 开门请求

```
POST /api/mobile/open
Content-Type: application/json
```

请求：
```json
{
  "userId": "<username>23",
  "deviceId": "D01-F1"
}
```

返回：
```json
{
  "batchId": "f07ed004-4386-4c6a-b3ee-fbacc0d0c9a1",
  "deviceId": "D01-F1",
  "message": "门已开启，请拿取商品"
}
```

| 字段 | 说明 |
|------|------|
| userId | 用户标识（手机端生成并保存，如设备UUID） |
| deviceId | 固定 `D01-F1` |
| batchId | **重要**：保存此ID，用于后续查询订单 |

### 2.3 查询订单（按 batch_id）

```
GET /api/mobile/order/{batchId}
```

**订单未生成时：**
```json
{
  "found": false,
  "message": "订单生成中，请稍候...",
  "batchId": "f07ed004-..."
}
```

**订单已生成时：**
```json
{
  "found": true,
  "batchId": "f07ed004-...",
  "orderId": 372,
  "totalAmount": 8.00,
  "payStatus": "UNPAID",
  "createTime": "2026-07-04T17:45:00",
  "items": [
    {"productId": 6, "productName": "农夫山泉", "qty": 1, "price": 2.50, "subtotal": 2.50},
    {"productId": 7, "productName": "润田", "qty": 1, "price": 1.50, "subtotal": 1.50},
    {"productId": 8, "productName": "酸奶", "qty": 1, "price": 4.00, "subtotal": 4.00}
  ]
}
```

### 2.4 订单历史

```
GET /api/mobile/orders?userId=<username>23
```

返回用户所有历史订单列表（格式同上）。

---

## 三、手机端开发要点

1. **首次启动**：生成唯一 `userId`（如 `UUID.randomUUID()`），存入本地存储
2. **商品列表**：调 `GET /api/mobile/products` 获取真实数据，**不要用假数据**
3. **开门**：调 `POST /api/mobile/open`，传 `{"userId":"xxx","deviceId":"D01-F1"}`，保存返回的 `batchId`
4. **等待结算**：关门后轮询 `GET /api/mobile/order/{batchId}`（建议 2 秒一次，最多 30 秒）
5. **展示结果**：`found=true` 时显示拿了什么、总金额
6. **订单归属**：即使 ESP32 不回传 batch_id，服务器也会按"最近开门用户"关联订单

---

## 四、测试

```bash
# 1. 查看商品
curl https://<server-ip>/api/mobile/products

# 2. 开门
curl -X POST https://<server-ip>/api/mobile/open \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","deviceId":"D01-F1"}'

# 3. 查订单（用返回的 batchId）
curl https://<server-ip>/api/mobile/order/{batchId}

# 4. 历史订单
curl https://<server-ip>/api/mobile/orders?userId=test
```
