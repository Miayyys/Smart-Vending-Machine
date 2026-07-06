package cn.retail.cloud.repository;

import cn.retail.cloud.entity.Device;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeviceRepository extends JpaRepository<Device, String> {}