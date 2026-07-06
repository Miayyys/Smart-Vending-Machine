package cn.retail.cloud.repository;

import cn.retail.cloud.entity.AnomalyAlert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;
import java.util.List;

public interface AnomalyAlertRepository extends JpaRepository<AnomalyAlert, Long> {
    List<AnomalyAlert> findByHandledOrderByCreateTimeDesc(Boolean handled);
    List<AnomalyAlert> findAllByOrderByCreateTimeDesc();

    @Modifying
    @Query("delete from AnomalyAlert a where a.createTime < ?1")
    int deleteByCreateTimeBefore(LocalDateTime cutoff);
}