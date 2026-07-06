package cn.retail.cloud.service;

import cn.retail.cloud.entity.Snapshot;
import cn.retail.cloud.repository.AnomalyAlertRepository;
import cn.retail.cloud.repository.OrderInfoRepository;
import cn.retail.cloud.repository.OrderItemRepository;
import cn.retail.cloud.repository.RestockAlertRepository;
import cn.retail.cloud.repository.SnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 数据清理服务：定时清理 + 一键清空。
 *
 * 定时清理默认每天凌晨 3:00 执行，删除超过 retentionDays 天的旧记录。
 * 一键清空接口由各 Controller 调用。
 */
@Service
public class CleanupService {

    private static final Logger log = LoggerFactory.getLogger(CleanupService.class);

    private final RestockAlertRepository restockRepo;
    private final AnomalyAlertRepository anomalyRepo;
    private final OrderInfoRepository orderRepo;
    private final OrderItemRepository orderItemRepo;
    private final SnapshotRepository snapRepo;
    private final Path snapshotsDir;

    @Value("${app.cleanup.retention-days:90}")
    private int retentionDays;

    public CleanupService(RestockAlertRepository restockRepo, AnomalyAlertRepository anomalyRepo,
                          OrderInfoRepository orderRepo, OrderItemRepository orderItemRepo,
                          SnapshotRepository snapRepo) {
        this.restockRepo = restockRepo;
        this.anomalyRepo = anomalyRepo;
        this.orderRepo = orderRepo;
        this.orderItemRepo = orderItemRepo;
        this.snapRepo = snapRepo;
        this.snapshotsDir = Paths.get("/app/snapshots");
    }

    // ======================== 定时清理 ========================

    /** 每天凌晨 3:00 执行 */
    @Scheduled(cron = "0 0 3 * * ?")
    public void scheduledCleanup() {
        log.info("定时清理开始, retentionDays={}", retentionDays);
        LocalDateTime cutoff = LocalDateTime.now().minusDays(retentionDays);
        int total = 0;
        total += cleanRestockAlerts(cutoff);
        total += cleanAnomalyAlerts(cutoff);
        total += cleanOrders(cutoff);
        total += cleanSnapshots(cutoff);
        log.info("定时清理完成, 共清理 {} 条记录", total);
    }

    @Transactional
    public int cleanRestockAlerts(LocalDateTime cutoff) {
        int n = restockRepo.deleteByCreateTimeBefore(cutoff);
        if (n > 0) log.info("清理补货告警 {} 条", n);
        return n;
    }

    @Transactional
    public int cleanAnomalyAlerts(LocalDateTime cutoff) {
        int n = anomalyRepo.deleteByCreateTimeBefore(cutoff);
        if (n > 0) log.info("清理异常告警 {} 条", n);
        return n;
    }

    @Transactional
    public int cleanOrders(LocalDateTime cutoff) {
        List<Long> ids = orderRepo.findIdsByCreateTimeBefore(cutoff);
        if (ids.isEmpty()) return 0;
        int items = orderItemRepo.deleteByOrderIdIn(ids);
        int orders = orderRepo.deleteByCreateTimeBefore(cutoff);
        log.info("清理订单明细 {} 条 + 订单 {} 条", items, orders);
        return items + orders;
    }

    @Transactional
    public int cleanSnapshots(LocalDateTime cutoff) {
        List<Snapshot> old = snapRepo.findByCreateTimeBefore(cutoff);
        if (old.isEmpty()) return 0;
        for (Snapshot s : old) {
            try { Files.deleteIfExists(snapshotsDir.resolve(s.getFilePath())); } catch (Exception ignored) {}
        }
        snapRepo.deleteAll(old);
        log.info("清理抓拍 {} 条", old.size());
        return old.size();
    }

    // ======================== 一键清空 ========================

    /** 清空所有补货告警 */
    @Transactional
    public int clearAllRestockAlerts() {
        long n = restockRepo.count();
        if (n == 0) return 0;
        restockRepo.deleteAll();
        log.info("一键清空补货告警 {} 条", n);
        return (int) n;
    }

    /** 清空所有异常告警 */
    @Transactional
    public int clearAllAnomalyAlerts() {
        long n = anomalyRepo.count();
        if (n == 0) return 0;
        anomalyRepo.deleteAll();
        log.info("一键清空异常告警 {} 条", n);
        return (int) n;
    }

    /** 清空所有订单（含明细） */
    @Transactional
    public int clearAllOrders() {
        long items = orderItemRepo.count();
        orderItemRepo.deleteAll();
        long orders = orderRepo.count();
        orderRepo.deleteAll();
        log.info("一键清空订单明细 {} 条 + 订单 {} 条", items, orders);
        return (int) (items + orders);
    }

    /** 清空所有抓拍图片（含文件） */
    @Transactional
    public int clearAllSnapshots() {
        List<Snapshot> all = snapRepo.findAll();
        if (all.isEmpty()) return 0;
        for (Snapshot s : all) {
            try { Files.deleteIfExists(snapshotsDir.resolve(s.getFilePath())); } catch (Exception ignored) {}
        }
        snapRepo.deleteAll(all);
        log.info("一键清空抓拍 {} 条", all.size());
        return all.size();
    }
}