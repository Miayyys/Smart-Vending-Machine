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
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 图片检测编排 — 硬件优先策略：
 *
 *  拍照上传 → 服务器 ONNX 推理（仅写 snapshot，不动库存/订单，source=server）
 *  硬件 MQTT detect → 驱动库存更新 + 订单生成（source=hardware）
 *
 *  服务器推理开关关闭时，ONNX 不跑，snapshot 标记 enabled=false。
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

    /** 硬件 detect 匹配 snapshot 的时间窗（秒） */
    private static final int MATCH_WINDOW_SEC = 30;

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

    // ==============================================================
    // A. 服务器兜底推理 — 仅写 snapshot 展示用，不动库存/订单
    // ==============================================================

    /**
     * 异步对 snapshot 图片做服务器 ONNX 推理（仅展示用，不驱动业务）。
     */
    @Async
    public void detectAndUpdateStock(Long snapshotId, String savedName, String deviceId, String doorAction) {
        String imagePath = "/app/snapshots/" + savedName;
        log.info("server-detect start snapshot={} device={} action={}", snapshotId, deviceId, doorAction);

        // 调推理服务（耗时 30-50ms，此期间硬件 detect 可能已到达）
        DetectionResult result = inferenceClient.detect(imagePath);

        // 重新查询 snapshot — 防止硬件 detect 先到达后被服务器结果覆盖
        Optional<Snapshot> opt = snapRepo.findById(snapshotId);
        if (opt.isEmpty()) {
            log.warn("snapshot {} not found", snapshotId);
            return;
        }
        Snapshot snap = opt.get();

        // 如果硬件已经覆盖过，服务器结果不再写入，只做双模交叉比对日志
        if (isHardwareCovered(snap)) {
            log.info("server-detect skipped snapshot={}: already covered by hardware", snapshotId);
            // 双模交叉比对：硬件 counts vs 服务器 counts — 不一致则告警
            if (result.isSuccess() && result.getCounts() != null) {
                Map<String, Integer> hwCounts = parseCountsFromSnapshot(snap);
                if (!hwCounts.isEmpty() && !countsRoughlyEqual(hwCounts, result.getCounts())) {
                    log.warn("cross-check MISMATCH snapshot={} hw={} server={}", snapshotId, hwCounts, result.getCounts());
                    String hwJson, svrJson;
                    try { hwJson = M.writeValueAsString(hwCounts); } catch (Exception e) { hwJson = "{}"; }
                    try { svrJson = M.writeValueAsString(result.getCounts()); } catch (Exception e) { svrJson = "{}"; }
                    alertService.raiseAnomaly(deviceId, "CROSS_CHECK_MISMATCH",
                            "{\"snapshot\":" + snapshotId + ",\"hw\":" + hwJson + ",\"server\":" + svrJson + "}",
                            "WARN");
                    // 使用服务器结果覆盖库存（服务器模型更全更准）
                    for (Map.Entry<String, Integer> e : result.getCounts().entrySet()) {
                        Long pid = CLASS_TO_PRODUCT.get(e.getKey());
                        if (pid != null) setStockQty(deviceId, pid, e.getValue());
                    }
                    log.info("cross-check override stock with server counts device={} counts={}", deviceId, result.getCounts());
                } else {
                    log.info("cross-check OK snapshot={} hw={} server={}", snapshotId, hwCounts, result.getCounts());
                }
            }
            return;
        }

        // 如果推理服务已关闭
        if (!result.isSuccess() && "inference disabled".equals(result.getError())) {
            Map<String, Object> note = new LinkedHashMap<>();
            note.put("source", "server");
            note.put("enabled", false);
            try {
                snap.setDetectionData(M.writeValueAsString(note));
            } catch (JsonProcessingException e) {
                snap.setDetectionData("{\"source\":\"server\",\"enabled\":false}");
            }
            snap.setDetectedAt(LocalDateTime.now());
            snapRepo.save(snap);
            log.info("server-detect skipped snapshot={}: inference disabled", snapshotId);
            return;
        }

        // 写结果到 snapshot（标注来源），仅此而已
        result.setSource("server");
        writeDetectionToSnapshot(snap, result);

        if (!result.isSuccess() || result.getCounts() == null) {
            log.warn("server-detect failed snapshot={} error={}", snapshotId, result.getError());
            return;
        }

        log.info("server-detect done snapshot={} device={} total={} counts={}",
                snapshotId, deviceId, result.getTotal(), result.getCounts());

        // 服务器推理只写 snapshot 展示，不更新库存、不生成订单
        // 但如果硬件已经先上报了，发一条双模交叉验证通知
        mqtt.notify(deviceId, "event", "server_detected", Map.of(
            "snapshotId", snapshotId,
            "source", "server",
            "counts", result.getCounts()
        ));
    }

    // ==============================================================
    // B. 硬件 detect 驱动业务 — 库存更新 + 订单生成
    // ==============================================================

    /**
     * 硬件 MQTT detect 上报 → 找到匹配的 snapshot，覆盖写入
     * 检测结果并驱动库存和订单。
     */
    @Transactional
    public void applyHardwareDetect(String deviceId, String doorAction,
                                     Map<String, Integer> counts,
                                     List<Map<String, Object>> details,
                                     String batchId) {
        log.info("hw-detect device={} action={} counts={} batch={}", deviceId, doorAction, counts, batchId);

        // 找匹配的 snapshot 前先检查是否有 unknown 标签
        boolean hasUnknown = !counts.isEmpty() && counts.keySet().stream().anyMatch(k -> "unknown".equals(k));
        // 过滤掉 unknown，保留已知类别
        if (hasUnknown) {
            log.warn("hw-detect has unknown labels device={} counts={} — filtering unknowns, keeping known classes",
                    deviceId, counts);
            counts = new java.util.LinkedHashMap<>(counts);
            counts.remove("unknown");
            // 过滤 details 中 class_name=unknown 的项
            if (details != null) {
                details = new java.util.ArrayList<>(details);
                details.removeIf(d -> "unknown".equals(d.get("class_name")));
            }
        }

        Snapshot snap = findMatchingSnapshot(deviceId, doorAction);
        if (snap == null) {
            log.warn("hw-detect no matching snapshot within {}s for device={} action={}",
                    MATCH_WINDOW_SEC, deviceId, doorAction);
            return;
        }

        // 过滤后 counts 为空（全部是 unknown），回退到服务器推理
        if (counts.isEmpty()) {
            log.warn("hw-detect IGNORED snapshot={}: all labels unknown, falling back to server inference",
                    snap.getId());
            detectAndUpdateStock(snap.getId(), snap.getFilePath(), deviceId, doorAction);
            return;
        }

        // 双模交叉比对：硬件写入前检查 snapshot 是否已有服务器推理结果
        Map<String, Integer> serverCounts = parseCountsFromSnapshot(snap);
        if (!serverCounts.isEmpty() && !countsRoughlyEqual(serverCounts, counts)) {
            log.warn("cross-check MISMATCH snapshot={} hw={} server={}", snap.getId(), counts, serverCounts);
            String hwJson, svrJson;
            try { hwJson = M.writeValueAsString(counts); } catch (Exception e) { hwJson = "{}"; }
            try { svrJson = M.writeValueAsString(serverCounts); } catch (Exception e) { svrJson = "{}"; }
            alertService.raiseAnomaly(deviceId, "CROSS_CHECK_MISMATCH",
                    "{\"snapshot\":" + snap.getId() + ",\"hw\":" + hwJson + ",\"server\":" + svrJson + "}",
                    "WARN");
            // 使用服务器结果替代硬件结果
            counts = serverCounts;
        } else if (!serverCounts.isEmpty()) {
            log.info("cross-check OK snapshot={} hw={} server={}", snap.getId(), counts, serverCounts);
        }

        // 硬件结果覆盖写入
        Map<String, Object> hwData = new LinkedHashMap<>();
        hwData.put("source", "hardware");
        hwData.put("batch_id", batchId);
        hwData.put("counts", counts);
        hwData.put("total", counts.values().stream().mapToInt(Integer::intValue).sum());
        hwData.put("details", details != null ? details : java.util.Collections.emptyList());
        hwData.put("success", true);
        try {
            snap.setDetectionData(M.writeValueAsString(hwData));
        } catch (JsonProcessingException e) {
            snap.setDetectionData("{\"source\":\"hardware\",\"error\":\"serialize\"}");
        }
        snap.setDetectedAt(LocalDateTime.now());
        snapRepo.save(snap);

        log.info("hw-detect written snapshot={} device={} source=hardware", snap.getId(), deviceId);

        // 缓存硬件结果（用于双模交叉验证）
        MobileUserSession.putDeviceDetection(deviceId, counts);

        // 按门动作分支
        if ("CLOSE".equals(doorAction)) {
            handleHardwareClose(snap, counts, deviceId);
        } else if ("SYNC".equals(doorAction)) {
            // 同步拍照：直接用当前检测结果覆盖库存（非购物流程，不生成订单）
            for (Map.Entry<String, Integer> e : counts.entrySet()) {
                Long productId = CLASS_TO_PRODUCT.get(e.getKey());
                if (productId != null) setStockQty(deviceId, productId, e.getValue());
            }
            MobileUserSession.putDeviceDetection(deviceId, counts);
            mqtt.notify(deviceId, "event", "stock_detected", Map.of(
                    "snapshotId", snap.getId(),
                    "deviceId", deviceId,
                    "doorAction", "SYNC",
                    "source", "hardware",
                    "counts", counts));
            log.info("hw-detect SYNC done snapshot={} device={} stock updated", snap.getId(), deviceId);
        } else {
            // OPEN — 只记录，不动库存和订单
            MobileUserSession.putDeviceDetection(deviceId, counts);
            mqtt.notify(deviceId, "event", "stock_detected", Map.of(
                "snapshotId", snap.getId(),
                "deviceId", deviceId,
                "doorAction", doorAction,
                "source", "hardware",
                "counts", counts
            ));
        }
    }

    /**
     * 硬件 CLOSE 检测：找最近 OPEN 的 counts → diff → 更新库存 → 生成订单。
     */
    private void handleHardwareClose(Snapshot closeSnap, Map<String, Integer> hwAfter, String deviceId) {
        int floor = closeSnap.getFloor();

        // 找最近一次 OPEN — 优先拿硬件覆盖后的 OPEN counts
        List<Snapshot> openList = snapRepo.findByDeviceIdAndFloorAndDoorActionOrderByCreateTimeDesc(
                deviceId, floor, "OPEN", PageRequest.of(0, 1));
        Snapshot openSnap = openList.isEmpty() ? null : openList.get(0);

        // 尝试从缓存拿硬件 OPEN counts，没有则从 snapshot JSON 解析
        Map<String, Integer> hwBefore = MobileUserSession.getDeviceDetection(deviceId);
        boolean beforeFromServer = false;
        if (hwBefore == null && openSnap != null && openSnap.getDetectionData() != null) {
            hwBefore = parseCountsFromSnapshot(openSnap);
            // 检查来源：若 OPEN 是服务器推理结果，与硬件 after 混用会导致 diff 不准
            String src = parseSourceFromSnapshot(openSnap);
            beforeFromServer = !"hardware".equals(src);
        }
        if (hwBefore == null) hwBefore = Collections.emptyMap();

        // 若 before 来自服务器而 after 来自硬件，diff 可能因模型差异而不准，记录告警
        if (beforeFromServer && !hwBefore.isEmpty()) {
            log.warn("hw-close using server before (not hardware) for diff snapshot={} device={} — diff may be inaccurate",
                    closeSnap.getId(), deviceId);
        }

        Map<String, Integer> before = hwBefore;
        Map<String, Integer> after = hwAfter;
        Map<String, Integer> diff = calcDiff(before, after);

        log.info("hw-close snapshot={} device={} floor={} before={} after={} diff={}",
                closeSnap.getId(), deviceId, floor, before, after, diff);

        // 更新库存为关门后（硬件）数量
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
        note.put("source", "hardware");
        note.put("counts", after);
        note.put("total", after.values().stream().mapToInt(Integer::intValue).sum());
        if (!diff.isEmpty()) {
            note.put("taken", diff);
        }
        mqtt.notify(deviceId, "event", "stock_detected", note);

        log.info("hw-close done snapshot={} device={} updatedStocks={} orderItems={}",
                closeSnap.getId(), deviceId, updated, diff.size());

        // 异物检测：关门照 vs 开门照（非拿取区）+ 关门照 vs 背景图（拿取区）
        try {
            checkForeignObject(closeSnap, openSnap, deviceId);
        } catch (Exception e) {
            log.warn("foreign-check failed snapshot={}: {}", closeSnap.getId(), e.getMessage());
        }
    }

    /**
     * 异物检测：调推理服务做区域像素比对，异常则发 CRIT 告警 + MQTT cmd/err 下发设备红灯。
     */
    private void checkForeignObject(Snapshot closeSnap, Snapshot openSnap, String deviceId) {
        if (openSnap == null) {
            log.debug("foreign-check skip snapshot={}: no matching OPEN", closeSnap.getId());
            return;
        }
        String closePath = "/app/snapshots/" + closeSnap.getFilePath();
        String openPath = "/app/snapshots/" + openSnap.getFilePath();
        String bgPath = "/app/snapshots/background_" + deviceId.replaceAll("[^A-Za-z0-9_-]", "") + ".jpg";
        java.io.File bgFile = new java.io.File(bgPath);
        String bg = bgFile.exists() ? bgPath : null;

        // 从 CLOSE 的 detection_data 取检测框（硬件或服务器均可）
        List<Map<String, Object>> boxes = extractBoxes(closeSnap);
        if (boxes.isEmpty()) {
            log.warn("foreign-check skip snapshot={}: no detection boxes available", closeSnap.getId());
            return;  // 没有检测框无法做区域比对，跳过避免全图误报
        }

        Map<String, Object> result = inferenceClient.compare(closePath, openPath, bg, boxes);

        // 检查 compare 是否真正成功
        if (Boolean.FALSE.equals(result.get("success"))) {
            log.error("foreign-check failed snapshot={}: compare service error", closeSnap.getId());
            alertService.raiseAnomaly(deviceId, "FOREIGN_CHECK_FAILED",
                    "{\"snapshot\":" + closeSnap.getId() + ",\"error\":\"compare service unavailable\"}",
                    "WARN");
            return;
        }

        boolean hasForeign = Boolean.TRUE.equals(result.get("has_foreign"));
        if (hasForeign) {
            log.warn("FOREIGN detected snapshot={} device={} alerts={}",
                    closeSnap.getId(), deviceId, result.get("alerts"));
            alertService.raiseAnomaly(deviceId, "FOREIGN_OBJECT",
                    "{\"snapshot\":" + closeSnap.getId() + ",\"alerts\":" + result.get("alerts") + "}",
                    "CRIT");
            mqtt.notify(deviceId, "cmd", "err", Map.of(
                    "type", "FOREIGN_OBJECT",
                    "level", "CRIT"));
        } else {
            log.info("foreign-check OK snapshot={} device={}", closeSnap.getId(), deviceId);
        }
    }

    /** 从 snapshot 的 detection_data JSON 提取检测框列表，fail-safe */
    private List<Map<String, Object>> extractBoxes(Snapshot snap) {
        List<Map<String, Object>> boxes = new ArrayList<>();
        try {
            if (snap.getDetectionData() != null) {
                Map<String, Object> d = M.readValue(snap.getDetectionData(), Map.class);
                Object det = d.get("details");
                if (det instanceof List) {
                    for (Object o : (List<?>) det) {
                        if (o instanceof Map) {
                            Map<?, ?> m = (Map<?, ?>) o;
                            Map<String, Object> box = new LinkedHashMap<>();
                            box.put("x1", m.get("x1"));
                            box.put("y1", m.get("y1"));
                            box.put("x2", m.get("x2"));
                            box.put("y2", m.get("y2"));
                            boxes.add(box);
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("extract boxes failed snapshot={}: {}", snap.getId(), e.getMessage());
        }
        return boxes;
    }

    // ==============================================================
    // 工具方法
    // ==============================================================

    /** 匹配最近一条同设备+动作+30s内的 snapshot（未被硬件覆盖的） */
    private Snapshot findMatchingSnapshot(String deviceId, String doorAction) {
        List<Snapshot> recent = snapRepo.findByDeviceIdAndDoorActionOrderByCreateTimeDesc(
                deviceId, doorAction, PageRequest.of(0, 20));
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(MATCH_WINDOW_SEC);
        for (Snapshot s : recent) {
            if (s.getCreateTime() == null || s.getCreateTime().isBefore(cutoff)) continue;
            // 选最近一条未被硬件覆盖或尚无检测结果的
            if (!isHardwareCovered(s)) return s;
        }
        return null;
    }

    private boolean isHardwareCovered(Snapshot snap) {
        String d = snap.getDetectionData();
        return d != null && d.contains("\"source\":\"hardware\"");
    }

    /** 比对两个 counts 映射是否大致一致（允许 ±1 或 30% 容差，避免硬件/服务器模型天然差异导致误报） */
    private static boolean countsRoughlyEqual(Map<String, Integer> a, Map<String, Integer> b) {
        if (a == null || b == null) return false;
        Set<String> keys = new HashSet<>(a.keySet());
        keys.addAll(b.keySet());
        for (String k : keys) {
            int va = a.getOrDefault(k, 0);
            int vb = b.getOrDefault(k, 0);
            if (va == vb) continue;
            int diff = Math.abs(va - vb);
            if (diff <= 1 && va > 0 && vb > 0) continue;     // 两端都有且差≤1, 容差; 0 vs N 则不算容差
            int maxVal = Math.max(va, vb);
            if (maxVal > 0 && (double) diff / maxVal <= 0.30) continue;  // 30% 以内容差
            return false;
        }
        return true;
    }

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

    /** 从 snapshot 的 detection_data JSON 中解析 source 字段（"hardware"/"server"/"server_fallback"） */
    private String parseSourceFromSnapshot(Snapshot snap) {
        if (snap == null || snap.getDetectionData() == null) return null;
        try {
            Map<String, Object> d = M.readValue(snap.getDetectionData(), Map.class);
            Object src = d.get("source");
            return src != null ? src.toString() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** diff = before - after，只保留正值（被拿走的）。遍历 before ∪ after 并集避免丢单/多算 */
    private Map<String, Integer> calcDiff(Map<String, Integer> before, Map<String, Integer> after) {
        if (before.isEmpty() && after.isEmpty()) return Collections.emptyMap();
        Set<String> allKeys = new LinkedHashSet<>(before.keySet());
        allKeys.addAll(after.keySet());
        Map<String, Integer> diff = new LinkedHashMap<>();
        for (String cls : allKeys) {
            int b = before.getOrDefault(cls, 0);
            int a = after.getOrDefault(cls, 0);
            int d = b - a;
            if (d > 0) diff.put(cls, d);
        }
        return diff;
    }

    /** 根据 diff 自动生成订单，自动关联手机端开门用户 */
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
        // 从手机开门缓存获取 userId，关联到订单
        String userId = MobileUserSession.getUserIdByDevice(deviceId);
        String cabinetId = toCabinetId(deviceId);
        alertService.createOrder(cabinetId, userId, "UNPAID", null, items);
        log.info("auto order created device={} userId={} snapshot={} items={}", cabinetId, userId, closeSnapshotId, diff);
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
            snap.setDetectionData("{\"source\":\"server\",\"error\":\"serialize failed\"}");
        }
        snap.setDetectedAt(LocalDateTime.now());
        snapRepo.save(snap);
    }

    // ==============================================================
    // C. 兜底定时任务 — 硬件超时未上报时用服务器结果补单
    // ==============================================================

    /** 硬件未上报的超时阈值（分钟） */
    private static final int FALLBACK_TIMEOUT_MIN = 1;

    /**
     * 每 30 秒检查一次：超过 {@value FALLBACK_TIMEOUT_MIN} 分钟未收到硬件 detect 的
     * CLOSE snapshot，用服务器 ONNX 结果兜底生成订单和更新库存。
     */
    @Scheduled(fixedDelay = 30_000)
    @Transactional
    public void fallbackCheck() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(FALLBACK_TIMEOUT_MIN);
        // 查最近 100 条 CLOSE 记录
        List<Snapshot> closeList = snapRepo.findByDoorActionOrderByCreateTimeDesc(
                "CLOSE", PageRequest.of(0, 100));

        int processed = 0;
        for (Snapshot snap : closeList) {
            // 只处理超时但还没被硬件覆盖且还没兜底过的
            if (snap.getCreateTime() == null || snap.getCreateTime().isAfter(cutoff)) continue;
            if (isHardwareCovered(snap)) continue;
            if (isFallbackProcessed(snap)) continue;

            // 解析服务器 counts
            Map<String, Integer> counts = parseCountsFromSnapshot(snap);
            if (counts.isEmpty()) continue;

            log.info("fallback CLOSE snapshot={} device={} counts={}", snap.getId(), snap.getDeviceId(), counts);

            // 找最近 OPEN 的 counts（优先硬件，其次服务器）
            List<Snapshot> openList = snapRepo.findByDeviceIdAndFloorAndDoorActionOrderByCreateTimeDesc(
                    snap.getDeviceId(), snap.getFloor(), "OPEN", PageRequest.of(0, 1));
            Snapshot openSnap = openList.isEmpty() ? null : openList.get(0);
            Map<String, Integer> before = parseCountsFromSnapshot(openSnap);

            Map<String, Integer> after = counts;
            Map<String, Integer> diff = calcDiff(before, after);

            // 更新库存
            for (Map.Entry<String, Integer> e : after.entrySet()) {
                Long productId = CLASS_TO_PRODUCT.get(e.getKey());
                if (productId != null) setStockQty(snap.getDeviceId(), productId, e.getValue());
            }

            // 生成订单
            if (!diff.isEmpty()) {
                createOrderFromDiff(snap.getDeviceId(), diff, snap.getId());
            }

            // 标记已兜底
            markFallbackProcessed(snap, counts);
            processed++;

            // MQTT 推送
            Map<String, Object> note = new LinkedHashMap<>();
            note.put("snapshotId", snap.getId());
            note.put("deviceId", snap.getDeviceId());
            note.put("doorAction", "CLOSE");
            note.put("source", "server_fallback");
            note.put("counts", after);
            if (!diff.isEmpty()) note.put("taken", diff);
            mqtt.notify(snap.getDeviceId(), "event", "stock_detected", note);
        }

        if (processed > 0) {
            log.info("fallback processed {} snapshots", processed);
        }
    }

    private boolean isFallbackProcessed(Snapshot snap) {
        String d = snap.getDetectionData();
        return d != null && d.contains("\"source\":\"server_fallback\"");
    }

    private void markFallbackProcessed(Snapshot snap, Map<String, Integer> counts) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("source", "server_fallback");
        data.put("counts", counts);
        data.put("total", counts.values().stream().mapToInt(Integer::intValue).sum());
        data.put("success", true);
        try {
            snap.setDetectionData(M.writeValueAsString(data));
        } catch (JsonProcessingException e) {
            snap.setDetectionData("{\"source\":\"server_fallback\",\"error\":\"serialize\"}");
        }
        snap.setDetectedAt(LocalDateTime.now());
        snapRepo.save(snap);
    }
}
