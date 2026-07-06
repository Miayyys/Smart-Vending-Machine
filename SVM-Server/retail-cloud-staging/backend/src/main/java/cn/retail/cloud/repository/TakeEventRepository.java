package cn.retail.cloud.repository;

import cn.retail.cloud.entity.TakeEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TakeEventRepository extends JpaRepository<TakeEvent, Long> {}