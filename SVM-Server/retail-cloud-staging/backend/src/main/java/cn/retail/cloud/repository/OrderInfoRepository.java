package cn.retail.cloud.repository;

import cn.retail.cloud.entity.OrderInfo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;
import java.util.List;

public interface OrderInfoRepository extends JpaRepository<OrderInfo, Long> {
    List<OrderInfo> findByDeviceIdOrderByCreateTimeDesc(String deviceId);

    @Modifying
    @Query("delete from OrderInfo o where o.createTime < ?1")
    int deleteByCreateTimeBefore(LocalDateTime cutoff);

    @Modifying
    @Query("select o.id from OrderInfo o where o.createTime < ?1")
    List<Long> findIdsByCreateTimeBefore(LocalDateTime cutoff);
}