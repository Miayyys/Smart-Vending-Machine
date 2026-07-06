package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "take_event")
public class TakeEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id")
    private String deviceId;
    @Column(name = "product_id")
    private Long productId;
    private String action;       // TAKE / PUTBACK
    @Column(name = "delta_qty")
    private Integer deltaQty;
    @Column(name = "weight_gram")
    private Integer weightGram;
    private LocalDateTime ts;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public Long getProductId(){return productId;}
    public void setProductId(Long v){this.productId=v;}
    public String getAction(){return action;}
    public void setAction(String v){this.action=v;}
    public Integer getDeltaQty(){return deltaQty;}
    public void setDeltaQty(Integer v){this.deltaQty=v;}
    public Integer getWeightGram(){return weightGram;}
    public void setWeightGram(Integer v){this.weightGram=v;}
    public LocalDateTime getTs(){return ts;}
    public void setTs(LocalDateTime v){this.ts=v;}
}