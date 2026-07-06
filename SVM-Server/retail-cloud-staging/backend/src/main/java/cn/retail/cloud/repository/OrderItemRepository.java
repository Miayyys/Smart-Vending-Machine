package cn.retail.cloud.repository;

import cn.retail.cloud.entity.OrderItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface OrderItemRepository extends JpaRepository<OrderItem, Long> {
    List<OrderItem> findByOrderId(Long orderId);

    @Modifying
    @Query("delete from OrderItem i where i.orderId in ?1")
    int deleteByOrderIdIn(List<Long> orderIds);
}