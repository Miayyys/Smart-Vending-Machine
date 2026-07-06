package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

/**
 * 设备用于图片上传的专用 token（免 Basic Auth）。
 * 对应表 device_token。一个 token 绑定一台设备。
 */
@Entity
@Table(name = "device_token")
public class DeviceToken {
    @Id
    @Column(length = 64)
    private String token;

    @Column(name = "device_id", nullable = false, length = 32)
    private String deviceId;

    @Column(nullable = false)
    private Boolean enabled = true;

    @Column(name = "create_time")
    private LocalDateTime createTime;

    public String getToken(){return token;}
    public void setToken(String v){this.token=v;}
    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public Boolean getEnabled(){return enabled;}
    public void setEnabled(Boolean v){this.enabled=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
}