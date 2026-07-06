package cn.retail.cloud.repository;

import cn.retail.cloud.entity.Stock;
import cn.retail.cloud.entity.Stock.StockPK;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface StockRepository extends JpaRepository<Stock, StockPK> {
    List<Stock> findByDeviceId(String deviceId);
    List<Stock> findByQtyLessThanEqual(Integer qty);
}