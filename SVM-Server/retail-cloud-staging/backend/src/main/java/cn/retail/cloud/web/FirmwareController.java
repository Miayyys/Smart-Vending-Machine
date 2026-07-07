package cn.retail.cloud.web;

import cn.retail.cloud.entity.Firmware;
import cn.retail.cloud.repository.FirmwareRepository;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/firmware")
public class FirmwareController {

    private final FirmwareRepository repo;
    private final Path storageDir = Paths.get("/app/firmware");

    public FirmwareController(FirmwareRepository repo) {
        this.repo = repo;
        try { Files.createDirectories(storageDir); } catch (Exception ignored) {}
    }

    /**
     * 上传固件
     */
    @PostMapping("/upload")
    public Firmware upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam("version") String version,
            @RequestParam(value = "type", defaultValue = "firmware") String type,
            @RequestParam(value = "description", defaultValue = "") String description) throws Exception {

        // 保存文件
        String fileName = file.getOriginalFilename();
        String savedName = System.currentTimeMillis() + "_" + (fileName != null ? fileName : "firmware.bin");
        Path dest = storageDir.resolve(savedName);
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, dest, StandardCopyOption.REPLACE_EXISTING);
        }

        // 计算 MD5
        String md5 = calcMd5(dest);

        Firmware fw = new Firmware();
        fw.setVersion(version);
        fw.setType(type);
        fw.setFileName(fileName);
        fw.setFilePath(savedName);
        fw.setFileSize(file.getSize());
        fw.setMd5(md5);
        fw.setDescription(description);
        fw.setCreateTime(LocalDateTime.now());
        return repo.save(fw);
    }

    /**
     * 固件列表（最新在前）
     */
    @GetMapping
    public List<Firmware> list() {
        return repo.findAll(org.springframework.data.domain.Sort.by(
                org.springframework.data.domain.Sort.Direction.DESC, "createTime"));
    }

    /**
     * 下载固件文件
     */
    @GetMapping("/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable Long id) {
        Firmware fw = repo.findById(id).orElse(null);
        if (fw == null) return ResponseEntity.notFound().build();
        Path file = storageDir.resolve(fw.getFilePath());
        if (!Files.exists(file)) return ResponseEntity.notFound().build();
        Resource resource = new FileSystemResource(file);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + (fw.getFileName() != null ? fw.getFileName() : "firmware.bin") + "\"")
                .body(resource);
    }

    /**
     * 删除固件
     */
    @DeleteMapping("/{id}")
    public String delete(@PathVariable Long id) {
        Firmware fw = repo.findById(id).orElse(null);
        if (fw == null) return "not found";
        try { Files.deleteIfExists(storageDir.resolve(fw.getFilePath())); } catch (Exception ignored) {}
        repo.delete(fw);
        return "deleted";
    }

    private String calcMd5(Path path) throws Exception {
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
}
