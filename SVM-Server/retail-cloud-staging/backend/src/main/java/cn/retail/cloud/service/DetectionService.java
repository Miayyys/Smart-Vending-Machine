package cn.retail.cloud.service;

import cn.retail.cloud.dto.DetectionResult;
import cn.retail.cloud.entity.OrderItem;
import cn.retail.cloud.entity.Snapshot;
import cn.retail.cloud.entity.Stock;
import cn.retail.cloud.mqtt.MqttPublisher;
import cn.retail.cloud.repository.SnapshotRepository;
import cn.retail.cloud.repository.StockRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 图片检测编排 — 完整业务逻辑：
 *
 * 开门(OPEN)：  AI 识别 → 记录 count_before，不更新库存
 * 关门(CLOSE)： AI 识别 → 找最近一次 OPEN 的 count_before
 *              → diff = before - after (拿取数量)
 *              → 自动生成订单 (diff > 0 的商品)
 *              → 更新库存为 count_after
 *              → MQTT 推送通知前端刷新
 */
@Service
public class DetectionService {

    private static final Logger log = LoggerFactory.getLogger(DetectionService.class);
    private static final ObjectMapper M = new ObjectMapper();

    /** 模型类别 → 商品ID 映射（对应 product 表） */
    private static final Map<String, Long> CLASS_TO_PRODUCT = Map.of(
        "nongfu", 6L,   // 农夫山泉
        "runtian", 7L,  // 润田
        "soda", 2L,     // 可乐
        "yogurt", 8L    // 酸奶
    );

    private final InferenceClient inferenceClient;
    private final SnapshotRepository snapRepo;
    private final StockRepository stockRepo;
    private final AlertService alertService;
    private final MqttPublisher mqtt;

    public DetectionService(InferenceClient inferenceClient,
                            SnapshotRepository snapRepo,
                            StockRepository stockRepo,
                            AlertService alertService,
                            MqttPublisher mqtt) {
        this.inferenceClient = inferenceClient;
        this.snapRepo = snapRepo;
        this.stockRepo = stockRepo;
        this.alertService = alertService;
        this.mqtt = mqtt;
    }

    /**
     * 异步对 snapshot 图片做推理，OPEN/CLOSE 走不同分支。
     */
    @Async
    @Transactional
    public void detectAndUpdateStock(Long snapshotId, String savedName, String deviceId, String doorAction) {
        String imagePath = "/app/snapshots/" + savedName;
        log.info("start detection snapshot={} device={} action={} path={}",
                snapshotId, deviceId, doorAction, imagePath);

        // 1. 调用推理服务
        DetectionResult result = inferenceClient.detect(imagePath);

        // 2. 写检测结果到 snapshot 记录
        Optional<Snapshot> opt = snapRepo.findById(snapshotId);
        if (opt.isEmpty()) {
            log.warn("snapshot {} not found", snapshotId);
            return;
        }
        Snapshot snap = opt.get();
        writeDetectionToSnapshot(snap, result);

        if (!result.isSuccess() || result.getCounts() == null) {
            log.warn("detection failed snapshot={} error={}", snapshotId, result.getError());
            return;
        }

        // 3. 根据开关门走不同分支
        if ("CLOSE".equals(doorAction)) {
            handleClose(snap, result);
        } else {
            handleOpen(snap, result);
        }
    }

    // ======================== OPEN ========================

    /**
     * 开门：只记录检测结果（count_before），不动库存。
     */
    private void handleOpen(Snapshot snap, DetectionResult result) {
        log.info("OPEN detected snapshot={} device={} total={}",
                snap.getId(), snap.getDeviceId(), result.getTotal());

        Map<String, Object> note = new LinkedHashMap<>();
        note.put("snapshotId", snap.getId());
        note.put("deviceId", snap.getDeviceId());
        note.put("doorAction", "OPEN");
        note.put("counts", result.getCounts());
        note.put("total", result.getTotal());
        mqtt.notify(snap.getDeviceId(), "event", "stock_detected", note);
    }

    // ======================== CLOSE ========================

    /**
     * 关门：找最近 OPEN 做 diff → 生成订单 → 更新库存。
     */
    private void handleClose(Snapshot closeSnap, DetectionResult closeResult) {
        String deviceId = closeSnap.getDeviceId();
        int floor = closeSnap.getFloor();
        Map<String, Integer> after = closeResult.getCounts();

        // 找最近一次开门抓拍（created before this close, same device+floor）
        List<Snapshot> openList = snapRepo.findByDeviceIdAndFloorAndDoorActionOrderByCreateTimeDesc(
                deviceId, floor, "OPEN", PageRequest.of(0, 1));
        Snapshot openSnap = openList.isEmpty() ? null : openList.get(0);

        Map<String, Integer> before = parseCountsFromSnapshot(openSnap);

        // 计算 diff = before - after（拿了多少），只取正值
        Map<String, Integer> diff = calcDiff(before, after);

        log.info("CLOSE detected snapshot={} device={} floor={} before={} after={} diff={}",
                closeSnap.getId(), deviceId, floor, before, after, diff);

        // 更新库存为关门后数量
        int updated = 0;
        for (Map.Entry<String, Integer> e : after.entrySet()) {
            Long productId = CLASS_TO_PRODUCT.get(e.getKey());
            if (productId != null) {
                setStockQty(deviceId, productId, e.getValue());
                updated++;
            }
        }

        // 生成订单（仅当有商品被拿走时）
        if (!diff.isEmpty()) {
            createOrderFromDiff(deviceId, diff, closeSnap.getId());
        }

        // MQTT 推送
        Map<String, Object> note = new LinkedHashMap<>();
        note.put("snapshotId", closeSnap.getId());
        note.put("deviceId", deviceId);
        note.put("doorAction", "CLOSE");
        note.put("counts", after);
        note.put("total", closeResult.getTotal());
        if (!diff.isEmpty()) {
            note.put("taken", diff);
        }
        mqtt.notify(deviceId, "event", "stock_detected", note);

        log.info("CLOSE done snapshot={} device={} updatedStocks={} orderItems={}",
                closeSnap.getId(), deviceId, updated, diff.size());
    }

    // ======================== 订单生成 ========================

    /**
     * 根据 diff 自动生成订单。diff 中的 key 是模型类别名，value 是拿取数量。
     */
    private void createOrderFromDiff(String deviceId, Map<String, Integer> diff, Long closeSnapshotId) {
        List<OrderItem> items = new ArrayList<>();
        for (Map.Entry<String, Integer> e : diff.entrySet()) {
            Long productId = CLASS_TO_PRODUCT.get(e.getKey());
            if (productId == null) continue;

            OrderItem item = new OrderItem();
            item.setProductId(productId);
            item.setQty(e.getValue());
            items.add(item);
        }

        if (items.isEmpty()) return;

        // 柜级设备 D01-F1 → D01
        String cabinetId = toCabinetId(deviceId);
        alertService.createOrder(cabinetId, null, "UNPAID", null, items);
        log.info("auto order created device={} snapshot={} items={}", cabinetId, closeSnapshotId, diff);
    }

    // ======================== 工具方法 ========================

    /** 设置某设备某商品的库存为指定数量 */
    private void setStockQty(String deviceId, Long productId, int qty) {
        Stock.StockPK pk = new Stock.StockPK(deviceId, productId);
        Stock s = stockRepo.findById(pk).orElse(null);
        if (s == null) {
            s = new Stock();
            s.setDeviceId(deviceId);
            s.setProductId(productId);
            s.setThreshold(3);
        }
        s.setQty(qty);
        s.setUpdateTime(LocalDateTime.now());
        stockRepo.save(s);
    }

    /** 从 snapshot 的 detection_data JSON 中解析 count */
    private Map<String, Integer> parseCountsFromSnapshot(Snapshot snap) {
        if (snap == null || snap.getDetectionData() == null) return Collections.emptyMap();
        try {
            DetectionResult r = M.readValue(snap.getDetectionData(), DetectionResult.class);
            return r.getCounts() != null ? r.getCounts() : Collections.emptyMap();
        } catch (Exception e) {
            return Collections.emptyMap();
        }
    }

    /** diff = before - after，只保留正值（被拿走的），忽略负值（放回的） */
    private Map<String, Integer> calcDiff(Map<String, Integer> before, Map<String, Integer> after) {
        if (before.isEmpty() || after.isEmpty()) return Collections.emptyMap();
        Map<String, Integer> diff = new LinkedHashMap<>();
        for (String cls : before.keySet()) {
            int b = before.getOrDefault(cls, 0);
            int a = after.getOrDefault(cls, 0);
            int d = b - a;
            if (d > 0) diff.put(cls, d);
        }
        return diff;
    }

    /** 楼层设备 D01-F1 → 柜级 D01 */
    private static String toCabinetId(String deviceId) {
        if (deviceId != null) {
            int idx = deviceId.indexOf("-F");
            if (idx > 0) return deviceId.substring(0, idx);
        }
        return deviceId;
    }

    /** 将检测结果 JSON 写入 snapshot */
    private void writeDetectionToSnapshot(Snapshot snap, DetectionResult result) {
        try {
            snap.setDetectionData(M.writeValueAsString(result));
        } catch (JsonProcessingException e) {
            snap.setDetectionData("{\"error\":\"serialize failed\"}");
        }
        snap.setDetectedAt(LocalDateTime.now());
        snapRepo.save(snap);
    }
}
