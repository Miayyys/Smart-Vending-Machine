package cn.retail.cloud.mqtt;

import cn.retail.cloud.service.AlertService;
import cn.retail.cloud.service.DetectionService;
import cn.retail.cloud.service.StockService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.integration.annotation.ServiceActivator;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageHandler;
import org.springframework.messaging.MessagingException;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 处理所有入站 MQTT 报文：按主题路由到对应业务。
 * 作为 @Bean MessageHandler 暴露，并用 @ServiceActivator 绑到 mqttInputChannel。 */
@Component
public class MqttMessageHandler {

    private static final Logger log = LoggerFactory.getLogger(MqttMessageHandler.class);
    private static final ObjectMapper M = new ObjectMapper();

    /**
     * 硬件 YOLO 模型类别 ID → 类别名 映射（必须与模型训练时的标签顺序一致）
     * 训练顺序: 0=nongfu 1=runtian 2=soda 3=yogurt
     * 当固件 "label" 字段缺失时，通过 "cls" 数值字段 fallback 映射。
     */
    private static final Map<Integer, String> CLS_TO_NAME = Map.of(
        0, "nongfu",
        1, "runtian",
        2, "soda",
        3, "yogurt"
    );

    private final StockService stockService;
    private final AlertService alertService;
    private final DetectionService detectionService;

    public MqttMessageHandler(StockService stockService, AlertService alertService,
                              DetectionService detectionService) {
        this.stockService = stockService;
        this.alertService = alertService;
        this.detectionService = detectionService;
    }

    @Bean
    @ServiceActivator(inputChannel = "mqttInputChannel")
    public MessageHandler handle() {
        return this::dispatch;
    }

    private void dispatch(Message<?> message) throws MessagingException {
        String topic = (String) message.getHeaders().get("mqtt_receivedTopic");
        Object payload = message.getPayload();
        String body = payload instanceof byte[] b ? new String(b) : String.valueOf(payload);
        log.debug("mqtt recv topic={} body={}", topic, body);
        if (topic == null) return;

        try {
            String[] parts = topic.split("/");
            // retail/<device>/<kind>/<sub>
            if (parts.length < 4) return;
            String device = parts[1];
            String kind = parts[2];
            String sub = parts[3];

            JsonNode n = body.isBlank() ? M.nullNode() : M.readTree(body);

            switch (kind) {
                case "event" -> handleEvent(device, sub, n);
                case "telemetry" -> handleTelemetry(device, sub, n);
                default -> log.warn("unknown kind {} on {}", kind, topic);
            }
        } catch (Exception e) {
            log.error("mqtt handle error topic={} err={}", topic, e.getMessage());
        }
    }

    private void handleEvent(String device, String sub, JsonNode n) {
        switch (sub) {
            case "take" -> {
                Long pid = n.hasNonNull("pid") ? n.get("pid").asLong() : null;
                String act = n.has("act") ? n.get("act").asText() : "TAKE";
                int qty = n.has("qty") ? n.get("qty").asInt(1) : 1;
                Integer w = n.hasNonNull("w") ? n.get("w").asInt() : null;
                stockService.handleTakeEvent(device, pid, act, qty, w);
            }
            case "settle" -> {
                String userId = n.has("uid") ? n.get("uid").asText() : null;
                BigDecimal total = n.has("amount") ? n.get("amount").decimalValue() : BigDecimal.ZERO;
                String status = n.has("status") ? n.get("status").asText() : "PAID";
                alertService.createOrder(device, userId, status, total, null);
            }
            case "detect" -> {
                // 硬件本地推理结果上报
                String batchId = n.has("batch_id") ? n.get("batch_id").asText() : "";
                String doorAction = n.has("door_action") ? n.get("door_action").asText() : "OPEN";
                Map<String, Integer> counts = new java.util.LinkedHashMap<>();
                List<Map<String, Object>> details = new java.util.ArrayList<>();
                if (n.has("detections") && n.get("detections").isArray()) {
                    for (JsonNode det : n.get("detections")) {
                        // 优先取 label 文本；缺失时用 cls 数值 fallback 映射
                        String label;
                        if (det.has("label") && !det.get("label").asText().isEmpty()) {
                            label = det.get("label").asText();
                        } else if (det.has("cls") && det.get("cls").isInt()) {
                            int clsId = det.get("cls").asInt();
                            label = CLS_TO_NAME.getOrDefault(clsId, "cls_" + clsId);
                            log.debug("label fallback: cls={} -> {}", clsId, label);
                        } else {
                            label = "unknown";
                        }
                        counts.merge(label, 1, Integer::sum);
                        Map<String, Object> item = new java.util.LinkedHashMap<>();
                        item.put("class_name", label);
                        item.put("confidence", det.has("score") ? det.get("score").asDouble() : 0);
                        item.put("x1", det.has("x1") ? det.get("x1").asDouble() : 0);
                        item.put("y1", det.has("y1") ? det.get("y1").asDouble() : 0);
                        item.put("x2", det.has("x2") ? det.get("x2").asDouble() : 0);
                        item.put("y2", det.has("y2") ? det.get("y2").asDouble() : 0);
                        details.add(item);
                    }
                }
                log.info("MQTT detect recv device={} batch={} action={} counts={}", device, batchId, doorAction, counts);
                detectionService.applyHardwareDetect(device, doorAction, counts, details, batchId);
            }
            case "anomaly" -> {
                String type = n.has("type") ? n.get("type").asText() : "UNKNOWN";
                String level = n.has("level") ? n.get("level").asText() : "WARN";
                alertService.raiseAnomaly(device, type, n.toString(), level);
            }
            default -> log.warn("unknown event sub {}", sub);
        }
    }

    private void handleTelemetry(String device, String sub, JsonNode n) {
        if ("weight".equals(sub) && n.hasNonNull("w")) {
            log.debug("telemetry weight {}={}g", device, n.get("w").asInt());
        }
    }
}