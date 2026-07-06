package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "order_item")
public class OrderItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_id")
    private Long orderId;
    @Column(name = "product_id")
    private Long productId;
    private Integer qty;
    private BigDecimal price;
    private BigDecimal subtotal;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public Long getOrderId(){return orderId;}
    public void setOrderId(Long v){this.orderId=v;}
    public Long getProductId(){return productId;}
    public void setProductId(Long v){this.productId=v;}
    public Integer getQty(){return qty;}
    public void setQty(Integer v){this.qty=v;}
    public BigDecimal getPrice(){return price;}
    public void setPrice(BigDecimal v){this.price=v;}
    public BigDecimal getSubtotal(){return subtotal;}
    public void setSubtotal(BigDecimal v){this.subtotal=v;}
}