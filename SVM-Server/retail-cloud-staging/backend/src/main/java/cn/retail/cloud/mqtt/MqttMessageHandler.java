package cn.retail.cloud.mqtt;

import cn.retail.cloud.service.AlertService;
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

/** 处理所有入站 MQTT 报文：按主题路由到对应业务。
 * 作为 @Bean MessageHandler 暴露，并用 @ServiceActivator 绑到 mqttInputChannel。 */
@Component
public class MqttMessageHandler {

    private static final Logger log = LoggerFactory.getLogger(MqttMessageHandler.class);
    private static final ObjectMapper M = new ObjectMapper();

    private final StockService stockService;
    private final AlertService alertService;

    public MqttMessageHandler(StockService stockService, AlertService alertService) {
        this.stockService = stockService;
        this.alertService = alertService;
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