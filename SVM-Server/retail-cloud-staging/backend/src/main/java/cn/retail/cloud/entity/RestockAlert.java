package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "restock_alert")
public class RestockAlert {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id")
    private String deviceId;
    @Column(name = "product_id")
    private Long productId;
    @Column(name = "cur_qty")
    private Integer curQty;
    private Integer threshold;
    private String status;          // PENDING / ACK
    @Column(name = "create_time")
    private LocalDateTime createTime;
    @Column(name = "ack_time")
    private LocalDateTime ackTime;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public Long getProductId(){return productId;}
    public void setProductId(Long v){this.productId=v;}
    public Integer getCurQty(){return curQty;}
    public void setCurQty(Integer v){this.curQty=v;}
    public Integer getThreshold(){return threshold;}
    public void setThreshold(Integer v){this.threshold=v;}
    public String getStatus(){return status;}
    public void setStatus(String v){this.status=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
    public LocalDateTime getAckTime(){return ackTime;}
    public void setAckTime(LocalDateTime v){this.ackTime=v;}
}