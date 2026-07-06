package cn.retail.cloud.web;

import cn.retail.cloud.entity.DeviceToken;
import cn.retail.cloud.entity.Snapshot;
import cn.retail.cloud.mqtt.MqttPublisher;
import cn.retail.cloud.repository.DeviceTokenRepository;
import cn.retail.cloud.repository.SnapshotRepository;
import cn.retail.cloud.service.CleanupService;
import cn.retail.cloud.service.DetectionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 售货柜楼层抓拍图片：设备开机/关门时上传图片，云台存储+记录+前端查看。
 *
 * 鉴权约定：
 *   - 上传 POST /api/snapshot/upload 走"设备专用 token"，nginx 该路径豁免 Basic Auth。
 *   - 其它接口（列表/图片流/删除/token 管理）仍受 nginx Basic Auth 保护。
 */
@RestController
@RequestMapping("/api/snapshot")
public class SnapshotController {

    private final SnapshotRepository snapRepo;
    private final DeviceTokenRepository tokenRepo;
    private final MqttPublisher mqtt;
    private final CleanupService cleanupService;
    private final DetectionService detectionService;
    private final Path storageDir;

    /** 每设备保留的最近图片数，超出自动删旧。默认 200。 */
    @Value("${snapshot.keep:200}")
    private int keepCount;

    @Autowired
    public SnapshotController(SnapshotRepository snapRepo, DeviceTokenRepository tokenRepo,
                              MqttPublisher mqtt, CleanupService cleanupService,
                              DetectionService detectionService) {
        this.snapRepo = snapRepo;
        this.tokenRepo = tokenRepo;
        this.mqtt = mqtt;
        this.cleanupService = cleanupService;
        this.detectionService = detectionService;
        this.storageDir = Paths.get("/app/snapshots");
        try { Files.createDirectories(storageDir); } catch (Exception ignored) {}
    }

    // ===================== 上传（设备 token 鉴权，免 Basic Auth） =====================

    @PostMapping("/upload")
    public ResponseEntity<?> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam("token") String token,
            @RequestParam("deviceId") String deviceId,
            @RequestParam("floor") Integer floor,
            @RequestParam("doorAction") String doorAction) {

        // 1. token 校验
        if (token == null || token.isBlank()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "missing token"));
        }
        Optional<DeviceToken> tk = tokenRepo.findByTokenAndEnabledTrue(token.trim());
        if (tk.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid token"));
        }
        // token 绑定的设备必须 == 请求的 deviceId（防伪造跨设备）
        if (!deviceId.equals(tk.get().getDeviceId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "token not for this device"));
        }

        // 2. 参数校验
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "empty file"));
        }
        if (floor == null || floor < 1) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid floor"));
        }
        String act = doorAction == null ? "" : doorAction.trim().toUpperCase();
        if (!act.equals("OPEN") && !act.equals("CLOSE")) {
            return ResponseEntity.badRequest().body(Map.of("error", "doorAction must be OPEN or CLOSE"));
        }

        try {
            // 3. 存盘：{ts}_{dev}_{floor}_{act}.{ext}
            String orig = file.getOriginalFilename();
            String ext = guessExt(orig);
            String savedName = System.currentTimeMillis() + "_" + deviceId + "_F" + floor + "_" + act + ext;
            Path dest = storageDir.resolve(savedName);
            try (InputStream in = file.getInputStream()) {
                Files.copy(in, dest, StandardCopyOption.REPLACE_EXISTING);
            }

            // 4. MD5
            String md5 = calcMd5(dest);

            // 5. 入库
            Snapshot s = new Snapshot();
            s.setDeviceId(deviceId);
            s.setFloor(floor);
            s.setDoorAction(act);
            s.setFileName(orig);
            s.setFilePath(savedName);
            s.setFileSize(file.getSize());
            s.setMd5(md5);
            s.setCreateTime(LocalDateTime.now());
            s = snapRepo.save(s);

            // 6. 自动清理：每设备超过 keepCount 删最旧的
            evictOld(deviceId);

            // 7. MQTT 通知前端实时刷新（尽力而为，失败不影响已上传结果）
            Map<String, Object> note = new HashMap<>();
            note.put("id", s.getId());
            note.put("deviceId", deviceId);
            note.put("floor", floor);
            note.put("doorAction", act);
            note.put("createTime", s.getCreateTime() != null ? s.getCreateTime().toString() : null);
            mqtt.notify(deviceId, "event", "snapshot", note);

            // 8. 异步触发 AI 视觉识别 + 库存更新（不阻塞上传响应）
            final Long snapId = s.getId();
            final String saved = savedName;
            final String dev = deviceId;
            final String actForDetect = act;
            detectionService.detectAndUpdateStock(snapId, saved, dev, actForDetect);

            // 9. 返回
            Map<String, Object> resp = new HashMap<>();
            resp.put("id", s.getId());
            resp.put("url", "/api/snapshot/" + s.getId() + "/file");
            resp.put("fileName", s.getFileName());
            resp.put("fileSize", s.getFileSize());
            resp.put("md5", s.getMd5());
            resp.put("floor", s.getFloor());
            resp.put("doorAction", s.getDoorAction());
            resp.put("createTime", s.getCreateTime());
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "save failed: " + e.getMessage()));
        }
    }

    // ===================== 列表（Basic Auth 保护） =====================

    @GetMapping
    public List<Snapshot> list(
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) Integer floor,
            @RequestParam(required = false) String doorAction,
            @RequestParam(defaultValue = "50") int limit) {
        int n = Math.min(Math.max(limit, 1), 500);
        var page = PageRequest.of(0, n, Sort.by(Sort.Direction.DESC, "createTime"));
        if (deviceId != null && !deviceId.isBlank()) {
            if (doorAction != null && !doorAction.isBlank()) {
                return snapRepo.findByDeviceIdAndDoorActionOrderByCreateTimeDesc(deviceId, doorAction.toUpperCase(), page);
            }
            return snapRepo.findByDeviceIdOrderByCreateTimeDesc(deviceId, page);
        }
        if (doorAction != null && !doorAction.isBlank()) {
            return snapRepo.findByDoorActionOrderByCreateTimeDesc(doorAction.toUpperCase(), page);
        }
        return snapRepo.findAllByOrderByCreateTimeDesc(page);
    }

    /** 返回带楼层可选筛选（列表接口本身不按 floor 过滤，这里给前端可选） */
    @GetMapping("/search")
    public List<Snapshot> search(
            @RequestParam(required = false) String deviceId,
            @RequestParam(required = false) Integer floor,
            @RequestParam(required = false) String doorAction,
            @RequestParam(defaultValue = "100") int limit) {
        List<Snapshot> all = list(deviceId, null, doorAction, Math.max(limit, 200));
        if (floor != null) {
            all = all.stream().filter(s -> floor.equals(s.getFloor())).toList();
        }
        return all.stream().limit(Math.max(limit, 1)).toList();
    }

    // ===================== 图片流（Basic Auth 保护，供前端 <img>） =====================

    @GetMapping("/{id}/file")
    public ResponseEntity<Resource> file(@PathVariable Long id) {
        Snapshot s = snapRepo.findById(id).orElse(null);
        if (s == null) return ResponseEntity.notFound().build();
        Path p = storageDir.resolve(s.getFilePath());
        if (!Files.exists(p)) return ResponseEntity.notFound().build();
        MediaType mt = contentType(s.getFilePath());
        Resource resource = new FileSystemResource(p);
        return ResponseEntity.ok()
                .contentType(mt)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + safeName(s) + "\"")
                .body(resource);
    }

    // ===================== 删除（Basic Auth 保护） =====================

    @DeleteMapping("/{id}")
    public String delete(@PathVariable Long id) {
        Snapshot s = snapRepo.findById(id).orElse(null);
        if (s == null) return "not found";
        try { Files.deleteIfExists(storageDir.resolve(s.getFilePath())); } catch (Exception ignored) {}
        snapRepo.delete(s);
        return "deleted";
    }

    /** 一键清空所有抓拍图片 */
    @DeleteMapping
    public Map<String,Object> clearAll() {
        int n = cleanupService.clearAllSnapshots();
        return Map.of("deleted", n);
    }

    // ===================== token 运维（Basic Auth 保护，不返回明文） =====================

    @GetMapping("/token")
    public List<Map<String, Object>> tokens() {
        return tokenRepo.findByEnabledTrue().stream()
                .map(t -> Map.<String, Object>of("deviceId", (Object) t.getDeviceId(), "tokenPrefix", mask(t.getToken())))
                .toList();
    }

    // ===================== 私有工具 =====================

    /** 超过 keepCount 的最旧记录连同文件一起删掉 */
    private void evictOld(String deviceId) {
        long count = snapRepo.countByDeviceId(deviceId);
        if (count <= keepCount) return;
        int toRemove = (int) (count - keepCount);
        List<Snapshot> old = snapRepo.findByDeviceIdOrderByIdAsc(deviceId, PageRequest.of(0, toRemove));
        for (Snapshot s : old) {
            try { Files.deleteIfExists(storageDir.resolve(s.getFilePath())); } catch (Exception ignored) {}
        }
        snapRepo.deleteAll(old);
    }

    private static String calcMd5(Path path) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] buf = new byte[8192];
        int n;
        try (InputStream in = Files.newInputStream(path)) {
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String guessExt(String name) {
        if (name != null) {
            int i = name.lastIndexOf('.');
            if (i >= 0 && i < name.length() - 1) return name.substring(i).toLowerCase();
        }
        return ".jpg";
    }

    private static MediaType contentType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".png")) return MediaType.IMAGE_PNG;
        if (p.endsWith(".gif")) return MediaType.IMAGE_GIF;
        if (p.endsWith(".webp")) return MediaType.parseMediaType("image/webp");
        return MediaType.IMAGE_JPEG;
    }

    private static String safeName(Snapshot s) {
        String n = s.getFileName();
        return (n != null && !n.isBlank()) ? n : s.getFilePath();
    }

    private static String mask(String token) {
        if (token == null || token.length() <= 6) return "***";
        return token.substring(0, 4) + "***" + token.substring(token.length() - 2);
    }
}