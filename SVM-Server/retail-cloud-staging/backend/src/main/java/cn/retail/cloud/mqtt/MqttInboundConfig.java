package cn.retail.cloud.mqtt;

import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.integration.channel.DirectChannel;
import org.springframework.integration.core.MessageProducer;
import org.springframework.integration.mqtt.core.DefaultMqttPahoClientFactory;
import org.springframework.integration.mqtt.core.MqttPahoClientFactory;
import org.springframework.integration.mqtt.inbound.MqttPahoMessageDrivenChannelAdapter;
import org.springframework.integration.mqtt.support.DefaultPahoMessageConverter;
import org.springframework.messaging.MessageChannel;

/** MQTT 入站配置：订阅 retail/+/event/# 与 retail/+/telemetry/#，分发到 mqttInputChannel */
@Configuration
public class MqttInboundConfig {

    @Value("${mqtt.host}") private String host;
    @Value("${mqtt.port:1883}") private int port;
    @Value("${mqtt.username}") private String username;
    @Value("${mqtt.password}") private String password;
    @Value("${mqtt.topic-prefix:retail}") private String prefix;

    @Bean
    public MqttPahoClientFactory mqttClientFactory() {
        DefaultMqttPahoClientFactory f = new DefaultMqttPahoClientFactory();
        MqttConnectOptions opts = new MqttConnectOptions();
        opts.setServerURIs(new String[]{"tcp://" + host + ":" + port});
        opts.setUserName(username);
        opts.setPassword(password.toCharArray());
        opts.setAutomaticReconnect(true);
        opts.setCleanSession(true);
        opts.setKeepAliveInterval(30);
        f.setConnectionOptions(opts);
        return f;
    }

    @Bean
    public MessageChannel mqttInputChannel() {
        return new DirectChannel();
    }

    @Bean
    public MessageProducer mqttInbound(MessageChannel mqttInputChannel, MqttPahoClientFactory factory) {
        String cId = "retail-backend-" + System.currentTimeMillis();
        String[] topics = {
            prefix + "/+/event/+",
            prefix + "/+/telemetry/+"
        };
        MqttPahoMessageDrivenChannelAdapter adapter =
                new MqttPahoMessageDrivenChannelAdapter(cId, factory, topics);
        adapter.setOutputChannel(mqttInputChannel);
        adapter.setCompletionTimeout(5000);
        adapter.setConverter(new DefaultPahoMessageConverter());
        adapter.setQos(1);
        return adapter;
    }
}