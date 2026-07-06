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
}
