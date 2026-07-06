package cn.retail.cloud.service;

import cn.retail.cloud.entity.*;
import cn.retail.cloud.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/** 库存与拿取事件处理：事件落库 → 更新实时库存 → 触发补货告警 */
@Service
public class StockService {

    private final StockRepository stockRepo;
    private final TakeEventRepository takeRepo;
    private final RestockAlertRepository restockRepo;
    private final DeviceRepository deviceRepo;

    public StockService(StockRepository stockRepo, TakeEventRepository takeRepo,
                        RestockAlertRepository restockRepo, DeviceRepository deviceRepo) {
        this.stockRepo = stockRepo;
        this.takeRepo = takeRepo;
        this.restockRepo = restockRepo;
        this.deviceRepo = deviceRepo;
    }

    public List<Stock> listStockOfDevice(String deviceId) {
        return stockRepo.findByDeviceId(deviceId);
    }

    public List<Stock> lowStockAll() {
        // 库存 <= 阈值 的柜-商品
        return stockRepo.findAll().stream()
                .filter(s -> s.getQty() != null && s.getThreshold() != null && s.getQty() <= s.getThreshold())
                .toList();
    }

    /** 处理一次拿取/放回事件：写事件流 + 改库存 + 评估补货告警 */
    @Transactional
    public TakeEvent handleTakeEvent(String deviceId, Long productId, String action, Integer qty, Integer weightGram) {
        if (qty == null) qty = 1;

        // 设备在线心跳更新
        deviceRepo.findById(deviceId).ifPresent(d -> {
            d.setOnline(true);
            d.setLastSeen(LocalDateTime.now());
            deviceRepo.save(d);
        });

        TakeEvent ev = new TakeEvent();
        ev.setDeviceId(deviceId);
        ev.setProductId(productId);
        ev.setAction(action == null ? "TAKE" : action);
        ev.setDeltaQty(qty);
        ev.setWeightGram(weightGram);
        ev.setTs(LocalDateTime.now());
        takeRepo.save(ev);

        if (productId != null) {
            updateStock(deviceId, productId, ev.getAction(), qty);
        }
        return ev;
    }

    private void updateStock(String deviceId, Long productId, String action, Integer qty) {
        Stock.StockPK pk = new Stock.StockPK(deviceId, productId);
        Stock s = stockRepo.findById(pk).orElse(null);
        if (s == null) {
            // 没有初始库存，建一条
            s = new Stock();
            s.setDeviceId(deviceId);
            s.setProductId(productId);
            s.setQty(0);
            s.setThreshold(3);
            s.setUpdateTime(LocalDateTime.now());
        }
        boolean take = "TAKE".equalsIgnoreCase(action);
        int cur = s.getQty() == null ? 0 : s.getQty();
        int next = take ? cur - qty : cur + qty;
        if (next < 0) next = 0;
        s.setQty(next);
        s.setUpdateTime(LocalDateTime.now());
        stockRepo.save(s);

        evaluateRestock(s);
    }

    /** 低于阈值且无处于 PENDING 的同柜商品告警 -> 新建一条补货提醒（按柜聚合） */
    private void evaluateRestock(Stock s) {
        if (s.getQty() <= s.getThreshold()) {
            String cabId = toCabinetId(s.getDeviceId());
            boolean hasPending = !restockRepo
                    .findByDeviceIdAndProductIdAndStatus(cabId, s.getProductId(), "PENDING")
                    .isEmpty();
            if (!hasPending) {
                RestockAlert a = new RestockAlert();
                a.setDeviceId(cabId);
                a.setProductId(s.getProductId());
                a.setCurQty(s.getQty());
                a.setThreshold(s.getThreshold());
                a.setStatus("PENDING");
                a.setCreateTime(LocalDateTime.now());
                restockRepo.save(a);
            }
        }
    }

    /** 楼层设备 D01-F1 → 柜级 D01，非楼层设备原样返回 */
    private static String toCabinetId(String deviceId) {
        if (deviceId != null) {
            int idx = deviceId.indexOf("-F");
            if (idx > 0) return deviceId.substring(0, idx);
        }
        return deviceId;
    }

    /** 提供库存补齐接口（REST reconcile 手塞测试用） */
    @Transactional
    public Optional<Stock> reconcile(String deviceId, Long productId, Integer qty, Integer threshold) {
        Stock.StockPK pk = new Stock.StockPK(deviceId, productId);
        Stock s = stockRepo.findById(pk).orElse(null);
        if (s == null) {
            if (qty == null) return Optional.empty();
            s = new Stock();
            s.setDeviceId(deviceId);
            s.setProductId(productId);
        }
        if (qty != null) s.setQty(qty);
        if (threshold != null) s.setThreshold(threshold);
        s.setUpdateTime(LocalDateTime.now());
        stockRepo.save(s);
        evaluateRestock(s);
        return Optional.of(s);
    }
}