package cn.retail.cloud.repository;

import cn.retail.cloud.entity.DeviceToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DeviceTokenRepository extends JpaRepository<DeviceToken, String> {

    Optional<DeviceToken> findByTokenAndEnabledTrue(String token);

    List<DeviceToken> findByEnabledTrue();
}