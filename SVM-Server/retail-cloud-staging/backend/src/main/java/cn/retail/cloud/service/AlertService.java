package cn.retail.cloud.service;

import cn.retail.cloud.entity.AnomalyAlert;
import cn.retail.cloud.entity.OrderInfo;
import cn.retail.cloud.entity.OrderItem;
import cn.retail.cloud.entity.Product;
import cn.retail.cloud.entity.RestockAlert;
import cn.retail.cloud.repository.AnomalyAlertRepository;
import cn.retail.cloud.repository.OrderInfoRepository;
import cn.retail.cloud.repository.OrderItemRepository;
import cn.retail.cloud.repository.ProductRepository;
import cn.retail.cloud.repository.RestockAlertRepository;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
public class AlertService {

    private final RestockAlertRepository restockRepo;
    private final AnomalyAlertRepository anomalyRepo;
    private final OrderInfoRepository orderRepo;
    private final OrderItemRepository orderItemRepo;
    private final ProductRepository productRepo;

    public AlertService(RestockAlertRepository restockRepo, AnomalyAlertRepository anomalyRepo,
                        OrderInfoRepository orderRepo, OrderItemRepository orderItemRepo,
                        ProductRepository productRepo) {
        this.restockRepo = restockRepo;
        this.anomalyRepo = anomalyRepo;
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.productRepo = productRepo;
    }

    public List<RestockAlert> listRestock(String status) {
        if (status == null || status.isBlank()) return restockRepo.findAll(Sort.by(Sort.Direction.DESC, "createTime"));
        return restockRepo.findByStatusOrderByCreateTimeDesc(status);
    }

    @Transactional
    public Optional<RestockAlert> ackRestock(Long id) {
        return restockRepo.findById(id).map(a -> {
            if (!"ACK".equals(a.getStatus())) {
                a.setStatus("ACK");
                a.setAckTime(LocalDateTime.now());
                restockRepo.save(a);
            }
            return a;
        });
    }

    @Transactional
    public AnomalyAlert raiseAnomaly(String deviceId, String alertType, String payload, String level) {
        AnomalyAlert a = new AnomalyAlert();
        a.setDeviceId(deviceId);
        a.setAlertType(alertType);
        a.setPayload(payload);
        a.setLevel(level == null ? "WARN" : level);
        a.setCreateTime(LocalDateTime.now());
        a.setHandled(false);
        return anomalyRepo.save(a);
    }

    public List<AnomalyAlert> listAnomaly(Boolean unhandledOnly) {
        if (unhandledOnly == null) return anomalyRepo.findAllByOrderByCreateTimeDesc();
        return anomalyRepo.findByHandledOrderByCreateTimeDesc(unhandledOnly);
    }

    // ---- 订单 ----
    @Transactional
    public OrderInfo createOrder(String deviceId, String userId, String payStatus,
                                 java.math.BigDecimal totalAmount,
                                 List<OrderItem> items) {
        OrderInfo o = new OrderInfo();
        o.setDeviceId(deviceId);
        o.setUserId(userId);
        o.setPayStatus(payStatus == null ? "UNPAID" : payStatus);
        o.setCreateTime(LocalDateTime.now());
        if ("PAID".equals(o.getPayStatus())) o.setSettleTime(LocalDateTime.now());

        // auto-fill price/subtotal from product table; compute total if not given
        BigDecimal computedTotal = BigDecimal.ZERO;
        if (items != null) {
            for (OrderItem it : items) {
                if (it.getProductId() != null) {
                    Product p = productRepo.findById(it.getProductId()).orElse(null);
                    if (p != null) {
                        // fill price from product if not provided by client
                        if (it.getPrice() == null) it.setPrice(p.getPrice());
                        // compute subtotal = price * qty
                        if (it.getPrice() != null && it.getQty() != null) {
                            it.setSubtotal(it.getPrice().multiply(BigDecimal.valueOf(it.getQty())));
                            computedTotal = computedTotal.add(it.getSubtotal());
                        }
                    }
                }
            }
        }
        // use computed total if client didn't provide it
        if (totalAmount == null || totalAmount.compareTo(BigDecimal.ZERO) == 0) {
            o.setTotalAmount(computedTotal);
        } else {
            o.setTotalAmount(totalAmount);
        }

        orderRepo.save(o);
        if (items != null) {
            for (OrderItem it : items) {
                it.setOrderId(o.getId());
                orderItemRepo.save(it);
            }
        }
        return o;
    }

    public List<OrderInfo> listOrders(String deviceId) {
        if (deviceId == null || deviceId.isBlank()) return orderRepo.findAll();
        return orderRepo.findByDeviceIdOrderByCreateTimeDesc(deviceId);
    }

    public List<OrderItem> listOrderItems(Long orderId) {
        return orderItemRepo.findByOrderId(orderId);
    }
}