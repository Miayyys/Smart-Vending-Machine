package cn.retail.cloud.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * 推理服务 POST /detect 返回的 JSON 结构
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class DetectionResult {

    private boolean success;
    @JsonProperty("image_path")
    private String imagePath;
    private Map<String, Integer> counts;
    private int total;
    private List<DetectionItem> details;
    @JsonProperty("processed_ms")
    private double processedMs;
    private String error;

    // ---- getters / setters ----
    public boolean isSuccess() { return success; }
    public void setSuccess(boolean v) { this.success = v; }

    public String getImagePath() { return imagePath; }
    public void setImagePath(String v) { this.imagePath = v; }

    public Map<String, Integer> getCounts() { return counts; }
    public void setCounts(Map<String, Integer> v) { this.counts = v; }

    public int getTotal() { return total; }
    public void setTotal(int v) { this.total = v; }

    public List<DetectionItem> getDetails() { return details; }
    public void setDetails(List<DetectionItem> v) { this.details = v; }

    public double getProcessedMs() { return processedMs; }
    public void setProcessedMs(double v) { this.processedMs = v; }

    public String getError() { return error; }
    public void setError(String v) { this.error = v; }

    // ---- nested ----
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class DetectionItem {
        @JsonProperty("class_name")
        private String className;
        private double confidence;
        private double x1, y1, x2, y2;

        public String getClassName() { return className; }
        public void setClassName(String v) { this.className = v; }
        public double getConfidence() { return confidence; }
        public void setConfidence(double v) { this.confidence = v; }
        public double getX1() { return x1; }
        public void setX1(double v) { this.x1 = v; }
        public double getY1() { return y1; }
        public void setY1(double v) { this.y1 = v; }
        public double getX2() { return x2; }
        public void setX2(double v) { this.x2 = v; }
        public double getY2() { return y2; }
        public void setY2(double v) { this.y2 = v; }
    }
}
