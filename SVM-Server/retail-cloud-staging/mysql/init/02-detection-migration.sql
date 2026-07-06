-- =========================================================
-- 检测结果迁移脚本 (2026-07-02)
-- 给已有 snapshot 表增加模型检测结果列 + 新增饮料商品
-- 幂等：重复执行不会报错
-- =========================================================

-- 新增检测结果列（用存储过程绕过 MySQL 8.0 无 IF NOT EXISTS 的问题）
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS _add_detection_cols()
BEGIN
  IF NOT EXISTS (SELECT * FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = 'retail_cloud'
                   AND TABLE_NAME = 'snapshot'
                   AND COLUMN_NAME = 'detection_data') THEN
    ALTER TABLE snapshot
      ADD COLUMN `detection_data` TEXT DEFAULT NULL COMMENT '模型检测结果JSON',
      ADD COLUMN `detected_at` DATETIME DEFAULT NULL COMMENT '检测完成时间';
  END IF;
END//
DELIMITER ;
CALL _add_detection_cols();
DROP PROCEDURE IF EXISTS _add_detection_cols;

-- 新增饮料商品（模型可识别的 4 类）
INSERT IGNORE INTO product (id, name, sku, price, weight_gram) VALUES
  (6, '农夫山泉', 'SKU-NONGFU', 2.00, 550),
  (7, '润田',     'SKU-RUNTIAN', 1.50, 550),
  (8, '酸奶',     'SKU-YOGURT',  4.00, 250);

-- 为现有楼层设备补充新饮料的库存（没有则插入）
INSERT IGNORE INTO stock (device_id, product_id, qty, threshold)
SELECT d.id, p.id, 10, 3
FROM device d CROSS JOIN product p
WHERE p.id IN (6, 7, 8)
  AND d.id LIKE '%-F%';
