package cn.retail.cloud.web;

import cn.retail.cloud.entity.OrderInfo;
import cn.retail.cloud.entity.OrderItem;
import cn.retail.cloud.service.AlertService;
import cn.retail.cloud.service.CleanupService;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final AlertService alertService;
    private final CleanupService cleanupService;
    public OrderController(AlertService a, CleanupService c){this.alertService=a; this.cleanupService=c;}

    @GetMapping
    public List<OrderInfo> list(@RequestParam(required=false) String deviceId){
        return alertService.listOrders(deviceId);
    }

    /** 简化创建：{deviceId,userId?,total?,status?,items:[{productId,qty,price,subtotal}]?} */
    @PostMapping
    public OrderInfo create(@RequestBody Map<String,Object> body){
        String deviceId = (String) body.get("deviceId");
        String userId = (String) body.get("userId");
        String status = (String) body.get("status");
        BigDecimal total = body.get("total")!=null?new BigDecimal(body.get("total").toString()):BigDecimal.ZERO;
        @SuppressWarnings("unchecked")
        List<Map<String,Object>> raw = (List<Map<String,Object>>) body.get("items");
        List<OrderItem> items = null;
        if (raw != null) {
            items = raw.stream().map(m -> {
                OrderItem it = new OrderItem();
                it.setProductId(toLong(m.get("productId")));
                it.setQty(toInt(m.get("qty")));
                it.setPrice(toBd(m.get("price")));
                it.setSubtotal(toBd(m.get("subtotal")));
                return it;
            }).toList();
        }
        return alertService.createOrder(deviceId,userId,status,total,items);
    }

    @GetMapping("/{id}/items")
    public List<OrderItem> items(@PathVariable Long id){return alertService.listOrderItems(id);}

    /** 一键清空所有订单 */
    @DeleteMapping
    public Map<String,Object> clearOrders() {
        int n = cleanupService.clearAllOrders();
        return Map.of("deleted", n);
    }

    private static Long toLong(Object o){return o==null?null:Long.valueOf(o.toString());}
    private static Integer toInt(Object o){return o==null?null:Integer.valueOf(o.toString());}
    private static BigDecimal toBd(Object o){return o==null?null:new BigDecimal(o.toString());}
}