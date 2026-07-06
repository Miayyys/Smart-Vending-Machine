package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "anomaly_alert")
public class AnomalyAlert {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id")
    private String deviceId;
    @Column(name = "alert_type")
    private String alertType;
    @Column(columnDefinition = "TEXT")
    private String payload;
    private String level;       // INFO/WARN/CRIT
    @Column(name = "create_time")
    private LocalDateTime createTime;
    private Boolean handled;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public String getAlertType(){return alertType;}
    public void setAlertType(String v){this.alertType=v;}
    public String getPayload(){return payload;}
    public void setPayload(String v){this.payload=v;}
    public String getLevel(){return level;}
    public void setLevel(String v){this.level=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
    public Boolean getHandled(){return handled;}
    public void setHandled(Boolean v){this.handled=v;}
}