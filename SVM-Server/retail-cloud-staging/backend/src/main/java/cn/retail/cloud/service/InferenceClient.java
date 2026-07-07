package cn.retail.cloud.service;

import cn.retail.cloud.dto.DetectionResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

/**
 * 调用 Python 推理服务 (retail-inference:8000)。
 * 使用 Spring RestTemplate，兼容性更好。
 */
@Component
public class InferenceClient {

    private static final Logger log = LoggerFactory.getLogger(InferenceClient.class);
    private static final ObjectMapper M = new ObjectMapper();

    private final RestTemplate rest;
    private final String detectUrl;
    private final String healthUrl;

    public InferenceClient(@Value("${inference.url:http://inference:8000}") String baseUrl) {
        this.rest = new RestTemplate();
        this.detectUrl = baseUrl + "/detect";
        this.healthUrl = baseUrl + "/health";
    }

    /**
     * 调用推理服务检测图片中的饮料。
     *
     * @param imagePath Docker 容器内图片路径 (共享 volume: /app/snapshots/xxx.jpg)
     * @return 检测结果；网络/服务异常时返回 success=false
     */
    public DetectionResult detect(String imagePath) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, String> body = Map.of("image_path", imagePath);
            HttpEntity<Map<String, String>> request = new HttpEntity<>(body, headers);

            ResponseEntity<String> resp = rest.postForEntity(detectUrl, request, String.class);

            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                return M.readValue(resp.getBody(), DetectionResult.class);
            } else {
                log.warn("inference service returned {}: {}", resp.getStatusCode(), resp.getBody());
                DetectionResult err = new DetectionResult();
                err.setSuccess(false);
                err.setError("HTTP " + resp.getStatusCodeValue() + ": " + resp.getBody());
                return err;
            }
        } catch (Exception e) {
            log.error("inference call failed for {}: {}", imagePath, e.getMessage());
            DetectionResult err = new DetectionResult();
            err.setSuccess(false);
            err.setError(e.getMessage());
            return err;
        }
    }

    /** 存活检查 */
    public boolean isHealthy() {
        try {
            ResponseEntity<String> resp = rest.getForEntity(healthUrl, String.class);
            return resp.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 调推理服务做异物比对。
     * @return Map 含 has_foreign (boolean) 和 alerts (list)；服务异常或不可用时返回 has_foreign=false
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> compare(String closeImage, String openImage,
                                        String backgroundImage, List<Map<String, Object>> boxes) {
        String url = healthUrl.replace("/health", "/compare");
        try {
            Map<String, Object> body = new java.util.HashMap<>();
            body.put("close_image", closeImage);
            body.put("open_image", openImage);
            if (backgroundImage != null) body.put("background_image", backgroundImage);
            body.put("boxes", boxes != null ? boxes : java.util.Collections.emptyList());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> req = new HttpEntity<>(body, headers);
            ResponseEntity<String> resp = rest.postForEntity(url, req, String.class);
            if (resp.getStatusCode().is2xxSuccessful() && resp.getBody() != null) {
                return M.readValue(resp.getBody(), Map.class);
            }
            log.warn("compare service returned {}: {}", resp.getStatusCode(), resp.getBody());
        } catch (Exception e) {
            log.error("compare call failed: {}", e.getMessage());
        }
        // 失败时不阻断主流程，按"无异物"处理
        Map<String, Object> fallback = new java.util.HashMap<>();
        fallback.put("success", false);
        fallback.put("has_foreign", false);
        return fallback;
    }
}
