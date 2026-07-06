package cn.retail.cloud.service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 手机端用户开门会话 — deviceId → userId 映射
 * 原则：最后一个开门用户获得订单归属
 */
public class MobileUserSession {

    /** deviceId → userId */
    private static final Map<String, String> lastOpenUser = new ConcurrentHashMap<>();
    /** deviceId → openTime */
    private static final Map<String, LocalDateTime> lastOpenTime = new ConcurrentHashMap<>();
    /** batchId → userId（兼容旧逻辑） */
    private static final Map<String, String> batchUserMap = new ConcurrentHashMap<>();
    /** batchId → time */
    private static final Map<String, LocalDateTime> batchTimeMap = new ConcurrentHashMap<>();

    public static void put(String deviceId, String batchId, String userId) {
        lastOpenUser.put(deviceId, userId);
        lastOpenTime.put(deviceId, LocalDateTime.now());
        batchUserMap.put(batchId, userId);
        batchTimeMap.put(batchId, LocalDateTime.now());
    }

    /** 按 deviceId 获取最近开门用户 */
    /** 缓存设备最近一次检测结果（3类），用于服务端交叉验证 */
    private static final Map<String, Map<String, Integer>> lastDeviceDetection = new ConcurrentHashMap<>();

    public static void putDeviceDetection(String deviceId, Map<String, Integer> counts) {
        lastDeviceDetection.put(deviceId, new java.util.HashMap<>(counts));
    }

    public static Map<String, Integer> getDeviceDetection(String deviceId) {
        return lastDeviceDetection.get(deviceId);
    }

    public static String getUserIdByDevice(String deviceId) {
        return lastOpenUser.get(deviceId);
    }

    /** 按 batchId 获取用户 */
    public static String getUserId(String batchId) {
        return batchUserMap.get(batchId);
    }

    public static LocalDateTime getOpenTime(String batchId) {
        return batchTimeMap.get(batchId);
    }
}
