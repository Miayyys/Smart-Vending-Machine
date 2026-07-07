package cn.retail.cloud.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

/**
 * MQTT 出站发布器 — 后端 → broker → 订阅端(前端/设备) 的轻量单向通知。
 * 与 MqttInboundConfig 解耦，独立 clientId，避免与入站订阅争用同一 client。
 * publish 失败只记日志、不影响业务（图片已上传入库，通知是"尽力而为"）。
 */
@Component
public class MqttPublisher {

    private static final Logger log = LoggerFactory.getLogger(MqttPublisher.class);
    private static final ObjectMapper M = new ObjectMapper();

    @Value("${mqtt.host}") private String host;
    @Value("${mqtt.port:1883}") private int port;
    @Value("${mqtt.username}") private String username;
    @Value("${mqtt.password}") private String password;
    @Value("${mqtt.topic-prefix:retail}") private String prefix;

    private MqttClient client;

    @jakarta.annotation.PostConstruct
    public void start() {
        try {
            String uri = "tcp://" + host + ":" + port;
            String clientId = "retail-pub-" + System.currentTimeMillis();
            client = new MqttClient(uri, clientId, new MemoryPersistence());
            MqttConnectOptions opts = new MqttConnectOptions();
            opts.setServerURIs(new String[]{uri});
            opts.setUserName(username);
            opts.setPassword(password.toCharArray());
            opts.setAutomaticReconnect(true);
            opts.setCleanSession(true);
            opts.setKeepAliveInterval(30);
            client.connect(opts);
            log.info("MqttPublisher connected to {}", uri);
        } catch (Exception e) {
            log.warn("MqttPublisher start failed (publish disabled): {}", e.getMessage());
        }
    }

    @PreDestroy
    public void stop() {
        try { if (client != null && client.isConnected()) client.disconnect(); } catch (Exception ignored) {}
        try { if (client != null) client.close(); } catch (Exception ignored) {}
    }

    /** 发布原始字符串到指定完整 topic，qos 默认 1，失败不抛 */
    public void publishRaw(String topic, String payload, int qos) {
        if (client == null || !client.isConnected()) {
            log.debug("publishRaw skipped: publisher not connected");
            return;
        }
        try {
            MqttMessage msg = new MqttMessage(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            msg.setQos(qos);
            client.publish(topic, msg);
            log.debug("mqtt publish topic={}", topic);
        } catch (Exception e) {
            log.warn("mqtt publishRaw failed: {}", e.getMessage());
        }
    }

    /** 发布一条 JSON 通知到 retail/{device}/{kind}/{sub}，失败不抛 */
    public void notify(String device, String kind, String sub, Object payload) {
        if (client == null || !client.isConnected()) {
            log.debug("notify skipped: publisher not connected ({} {})", kind, sub);
            return;
        }
        try {
            String topic = prefix + "/" + device + "/" + kind + "/" + sub;
            String body = payload instanceof String s ? s : M.writeValueAsString(payload);
            MqttMessage msg = new MqttMessage(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            msg.setQos(1);
            client.publish(topic, msg);
            log.debug("mqtt publish topic={} body={}", topic, body);
        } catch (Exception e) {
            log.warn("mqtt publish failed: {}", e.getMessage());
        }
    }
}