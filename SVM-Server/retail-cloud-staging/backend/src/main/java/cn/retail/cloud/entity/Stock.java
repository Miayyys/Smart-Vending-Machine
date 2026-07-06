package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "stock")
@IdClass(Stock.StockPK.class)
public class Stock {
    @Id
    @Column(name = "device_id")
    private String deviceId;
    @Id
    @Column(name = "product_id")
    private Long productId;

    private Integer qty;
    private Integer threshold;
    @Column(name = "update_time")
    private LocalDateTime updateTime;

    public static class StockPK implements java.io.Serializable {
        public String deviceId;
        public Long productId;
        public StockPK(){}
        public StockPK(String d, Long p){this.deviceId=d;this.productId=p;}
        @Override public boolean equals(Object o){if(!(o instanceof StockPK x))return false; return java.util.Objects.equals(deviceId,x.deviceId)&&java.util.Objects.equals(productId,x.productId);}
        @Override public int hashCode(){return java.util.Objects.hash(deviceId,productId);}
    }

    public String getDeviceId(){return deviceId;}
    public void setDeviceId(String v){this.deviceId=v;}
    public Long getProductId(){return productId;}
    public void setProductId(Long v){this.productId=v;}
    public Integer getQty(){return qty;}
    public void setQty(Integer v){this.qty=v;}
    public Integer getThreshold(){return threshold;}
    public void setThreshold(Integer v){this.threshold=v;}
    public LocalDateTime getUpdateTime(){return updateTime;}
    public void setUpdateTime(LocalDateTime v){this.updateTime=v;}
}