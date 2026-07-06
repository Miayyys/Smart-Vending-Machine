package cn.retail.cloud.web;

import cn.retail.cloud.entity.OrderInfo;
import cn.retail.cloud.entity.OrderItem;
import cn.retail.cloud.entity.Product;
import cn.retail.cloud.mqtt.MqttPublisher;
import cn.retail.cloud.repository.OrderInfoRepository;
import cn.retail.cloud.repository.OrderItemRepository;
import cn.retail.cloud.repository.ProductRepository;
import cn.retail.cloud.service.MobileUserSession;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 手机用户端 API — 顾客用
 * 流程：查看商品 → 开门 → 拿取 → 关门 → 自动结算 → 查看订单
 */
@RestController
@RequestMapping("/api/mobile")
public class MobileController {

    private final ProductRepository productRepo;
    private final OrderInfoRepository orderRepo;
    private final OrderItemRepository orderItemRepo;
    private final MqttPublisher mqtt;

    public MobileController(ProductRepository productRepo, OrderInfoRepository orderRepo,
                            OrderItemRepository orderItemRepo, MqttPublisher mqtt) {
        this.productRepo = productRepo;
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.mqtt = mqtt;
    }

    // ==================== 开门 ====================

    /**
     * 用户请求开门
     * POST /api/mobile/open
     * Body: {"userId": "user123", "deviceId": "D01-F1"}
     * 返回 batch_id，用于后续查询订单
     */
    @PostMapping("/open")
    public Map<String, Object> openDoor(@RequestBody Map<String, Object> body) {
        String userId = (String) body.getOrDefault("userId", "anonymous");
        String deviceId = (String) body.getOrDefault("deviceId", "D01-F1");
        String batchId = UUID.randomUUID().toString();

        MobileUserSession.put(deviceId, batchId, userId);

        // 下发开门指令到设备（带 batch_id，设备识别时需回传）
        String cmdBody = String.format(
            "{\"action\":\"UNLOCK\",\"duration\":30,\"batch_id\":\"%s\"}", batchId);
        mqtt.publishRaw("retail/" + deviceId + "/cmd/unlock", cmdBody, 1);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("batchId", batchId);
        resp.put("deviceId", deviceId);
        resp.put("message", "门已开启，请拿取商品");
        return resp;
    }

    // ==================== 商品列表 ====================

    /** GET /api/mobile/products */
    @GetMapping("/products")
    public List<Map<String, Object>> products() {
        List<Product> list = productRepo.findAll();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Product p : list) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", p.getId());
            m.put("name", p.getName());
            m.put("price", p.getPrice());
            m.put("sku", p.getSku());
            m.put("imageUrl", p.getImageUrl());
            result.add(m);
        }
        return result;
    }

    // ==================== 订单查询 ====================

    /**
     * 根据 batch_id 查询订单
     * GET /api/mobile/order/{batchId}
     */
    @GetMapping("/order/{batchId}")
    public Map<String, Object> getOrderByBatch(@PathVariable String batchId) {
        Map<String, Object> resp = new LinkedHashMap<>();
        String userId = MobileUserSession.getUserId(batchId);

        // 查找开门后创建的匹配订单
        List<OrderInfo> orders = orderRepo.findAllByOrderByIdDesc();
        OrderInfo found = null;
        for (OrderInfo o : orders) {
            if (userId != null && userId.equals(o.getUserId())) {
                // 找开门时间之后创建的订单
                LocalDateTime openTime = MobileUserSession.getOpenTime(batchId);
                if (openTime != null && o.getCreateTime() != null
                        && !o.getCreateTime().isBefore(openTime)) {
                    found = o;
                    break;
                }
            }
        }

        if (found != null) {
            resp.put("found", true);
            resp.put("orderId", found.getId());
            resp.put("totalAmount", found.getTotalAmount());
            resp.put("payStatus", found.getPayStatus());
            resp.put("createTime", found.getCreateTime());
            List<OrderItem> items = orderItemRepo.findByOrderId(found.getId());
            List<Map<String, Object>> itemList = new ArrayList<>();
            for (OrderItem it : items) {
                Product p = productRepo.findById(it.getProductId()).orElse(null);
                Map<String, Object> im = new LinkedHashMap<>();
                im.put("productId", it.getProductId());
                im.put("productName", p != null ? p.getName() : "未知");
                im.put("qty", it.getQty());
                im.put("price", it.getPrice());
                im.put("subtotal", it.getSubtotal());
                itemList.add(im);
            }
            resp.put("items", itemList);
        } else {
            resp.put("found", false);
            resp.put("message", "订单生成中，请稍候...");
        }
        resp.put("batchId", batchId);
        return resp;
    }

    /**
     * 用户订单历史
     * GET /api/mobile/orders?userId=user123
     */
    @GetMapping("/orders")
    public List<Map<String, Object>> getUserOrders(@RequestParam String userId) {
        List<OrderInfo> all = orderRepo.findAllByOrderByIdDesc();
        List<Map<String, Object>> result = new ArrayList<>();
        for (OrderInfo o : all) {
            if (userId.equals(o.getUserId())) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", o.getId());
                m.put("totalAmount", o.getTotalAmount());
                m.put("payStatus", o.getPayStatus());
                m.put("createTime", o.getCreateTime());
                List<OrderItem> items = orderItemRepo.findByOrderId(o.getId());
                List<Map<String, Object>> itemList = new ArrayList<>();
                for (OrderItem it : items) {
                    Product p = productRepo.findById(it.getProductId()).orElse(null);
                    Map<String, Object> im = new LinkedHashMap<>();
                    im.put("productName", p != null ? p.getName() : "未知");
                    im.put("qty", it.getQty());
                    im.put("subtotal", it.getSubtotal());
                    itemList.add(im);
                }
                m.put("items", itemList);
                result.add(m);
            }
        }
        return result;
    }

    // ==================== 支付确认 ====================

    @PostMapping("/pay")
    public ResponseEntity<Map<String, Object>> confirmPay(@RequestBody Map<String, Object> body) {
        Long orderId = body.containsKey("orderId") ? Long.valueOf(body.get("orderId").toString()) : null;
        String userId = (String) body.get("userId");
        if (orderId == null) return ResponseEntity.badRequest().body(Map.of("error", "orderId required"));

        OrderInfo order = orderRepo.findById(orderId).orElse(null);
        if (order == null) return ResponseEntity.status(404).body(Map.of("error", "order not found"));

        if (userId != null && order.getUserId() != null && !userId.equals(order.getUserId()))
            return ResponseEntity.status(403).body(Map.of("error", "userId mismatch"));

        if ("PAID".equals(order.getPayStatus()))
            return ResponseEntity.ok(Map.of("orderId", orderId, "message", "already paid", "payStatus", "PAID"));

        order.setPayStatus("PAID");
        order.setSettleTime(LocalDateTime.now());
        if (userId != null && order.getUserId() == null) order.setUserId(userId);
        orderRepo.save(order);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("orderId", orderId);
        resp.put("payStatus", "PAID");
        resp.put("settleTime", order.getSettleTime().toString());
        resp.put("totalAmount", order.getTotalAmount());
        resp.put("message", "支付成功");
        return ResponseEntity.ok(resp);
    }

}
