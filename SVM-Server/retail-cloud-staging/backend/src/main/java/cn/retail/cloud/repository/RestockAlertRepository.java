package cn.retail.cloud.repository;

import cn.retail.cloud.entity.RestockAlert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;
import java.util.List;

public interface RestockAlertRepository extends JpaRepository<RestockAlert, Long> {
    List<RestockAlert> findByStatusOrderByCreateTimeDesc(String status);
    List<RestockAlert> findByDeviceIdAndProductIdAndStatus(String deviceId, Long productId, String status);

    @Modifying
    @Query("delete from RestockAlert r where r.createTime < ?1")
    int deleteByCreateTimeBefore(LocalDateTime cutoff);
}