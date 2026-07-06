package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "order_info")
public class OrderInfo {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id")
    private String deviceId;
    @Column(name = "user_id")
    private String userId;
    @Column(name = "total_amount")
    private BigDecimal totalAmount;
    @Column(name = "pay_status")
    private String payStatus;
    @Column(name = "create_time")
    private LocalDateTime createTime;
    @Column(name = "settle_time")
    private LocalDateTime settleTime;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public String getUserId(){return userId;}
    public void setUserId(String v){this.userId=v;}
    public BigDecimal getTotalAmount(){return totalAmount;}
    public void setTotalAmount(BigDecimal v){this.totalAmount=v;}
    public String getPayStatus(){return payStatus;}
    public void setPayStatus(String v){this.payStatus=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
    public LocalDateTime getSettleTime(){return settleTime;}
    public void setSettleTime(LocalDateTime v){this.settleTime=v;}
}