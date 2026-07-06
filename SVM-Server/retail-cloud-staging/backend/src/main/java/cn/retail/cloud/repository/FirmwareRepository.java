package cn.retail.cloud.repository;

import cn.retail.cloud.entity.Firmware;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface FirmwareRepository extends JpaRepository<Firmware, Long> {
    Optional<Firmware> findTopByOrderByCreateTimeDesc();
}
