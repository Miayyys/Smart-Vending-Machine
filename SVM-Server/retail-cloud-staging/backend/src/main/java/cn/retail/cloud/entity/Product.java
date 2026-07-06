package cn.retail.cloud.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "product")
public class Product {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private String sku;
    private BigDecimal price;
    private Integer weightGram;
    private String imageUrl;
    private LocalDateTime createTime;

    public Long getId(){return id;}
    public void setId(Long v){this.id=v;}
    public String getName(){return name;}
    public void setName(String v){this.name=v;}
    public String getSku(){return sku;}
    public void setSku(String v){this.sku=v;}
    public BigDecimal getPrice(){return price;}
    public void setPrice(BigDecimal v){this.price=v;}
    public Integer getWeightGram(){return weightGram;}
    public void setWeightGram(Integer v){this.weightGram=v;}
    public String getImageUrl(){return imageUrl;}
    public void setImageUrl(String v){this.imageUrl=v;}
    public LocalDateTime getCreateTime(){return createTime;}
    public void setCreateTime(LocalDateTime v){this.createTime=v;}
}