-- =========================================================
-- 零售柜云平台 - MySQL schema (首启注入，幂等)
-- DB: retail_cloud   用户: retail
-- 字符集: utf8mb4 / collation: utf8mb4_unicode_ci
-- 时间: 2026-06-26
-- =========================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

-- ---------- 商品 ----------
CREATE TABLE IF NOT EXISTS `product` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(64)  NOT NULL,
  `sku`          VARCHAR(64)          DEFAULT NULL,
  `price`        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `weight_gram`  INT                   DEFAULT 0,
  `image_url`    VARCHAR(255)          DEFAULT NULL,
  `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sku` (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 零售柜/设备 ----------
CREATE TABLE IF NOT EXISTS `device` (
  `id`          VARCHAR(32)  NOT NULL,
  `name`        VARCHAR(64)  NOT NULL,
  `location`    VARCHAR(128)          DEFAULT NULL,
  `online`      TINYINT(1)   NOT NULL DEFAULT 0,
  `last_seen`   DATETIME             DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 实时库存 ----------
CREATE TABLE IF NOT EXISTS `stock` (
  `device_id`   VARCHAR(32)  NOT NULL,
  `product_id`  BIGINT       NOT NULL,
  `qty`         INT          NOT NULL DEFAULT 0,
  `threshold`   INT          NOT NULL DEFAULT 3,
  `update_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`device_id`,`product_id`),
  KEY `idx_product` (`product_id`),
  CONSTRAINT `fk_stock_product` FOREIGN KEY (`product_id`) REFERENCES `product`(`id`),
  CONSTRAINT `fk_stock_device`  FOREIGN KEY (`device_id`)  REFERENCES `device`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 拿取/放回事件流 ----------
CREATE TABLE IF NOT EXISTS `take_event` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `device_id`   VARCHAR(32)  NOT NULL,
  `product_id`  BIGINT                DEFAULT NULL,
  `action`      VARCHAR(16)  NOT NULL,  -- TAKE / PUTBACK
  `delta_qty`   INT          NOT NULL DEFAULT 1,
  `weight_gram` INT                   DEFAULT NULL,
  `ts`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_ts` (`device_id`,`ts`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 结算订单 ----------
CREATE TABLE IF NOT EXISTS `order_info` (
  `id`           BIGINT        NOT NULL AUTO_INCREMENT,
  `device_id`    VARCHAR(32)   NOT NULL,
  `user_id`      VARCHAR(64)            DEFAULT NULL,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `pay_status`   VARCHAR(16)   NOT NULL DEFAULT 'UNPAID', -- UNPAID/PAID/FAILED
  `create_time`  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `settle_time`  DATETIME               DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dev` (`device_id`),
  KEY `idx_create` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 订单明细 ----------
CREATE TABLE IF NOT EXISTS `order_item` (
  `id`         BIGINT        NOT NULL AUTO_INCREMENT,
  `order_id`   BIGINT        NOT NULL,
  `product_id` BIGINT        NOT NULL,
  `qty`        INT           NOT NULL DEFAULT 1,
  `price`      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `subtotal`  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  CONSTRAINT `fk_oi_order` FOREIGN KEY (`order_id`) REFERENCES `order_info`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 补货提醒 ----------
CREATE TABLE IF NOT EXISTS `restock_alert` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `device_id`   VARCHAR(32)  NOT NULL,
  `product_id`  BIGINT       NOT NULL,
  `cur_qty`     INT          NOT NULL,
  `threshold`   INT          NOT NULL,
  `status`      VARCHAR(16)  NOT NULL DEFAULT 'PENDING', -- PENDING/ACK
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ack_time`    DATETIME              DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_dev_prd` (`device_id`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 异常预警 ----------
CREATE TABLE IF NOT EXISTS `anomaly_alert` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `device_id`   VARCHAR(32)  NOT NULL,
  `alert_type`  VARCHAR(32)  NOT NULL,  -- UNPAID_OPEN / WEIGHT_MISMATCH / TAKE_EXCEED ...
  `payload`      TEXT,
  `level`        VARCHAR(16)  NOT NULL DEFAULT 'WARN', -- INFO/WARN/CRIT
  `create_time`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `handled`      TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_dev` (`device_id`),
  KEY `idx_unhandled` (`handled`,`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 固件版本 ----------
CREATE TABLE IF NOT EXISTS `firmware` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `version`     VARCHAR(32)  NOT NULL,
  `file_name`   VARCHAR(128) DEFAULT NULL,
  `file_path`   VARCHAR(255) DEFAULT NULL,
  `file_size`   BIGINT       DEFAULT 0,
  `md5`         VARCHAR(64)  DEFAULT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS=1;

-- =========================================================
-- 种子数据（联调用，幂等：先清后插）
-- =========================================================
INSERT IGNORE INTO `product` (`id`,`name`,`sku`,`price`,`weight_gram`) VALUES
 (2,'汽水','SKU-SODA',  3.50, 330),
 (6,'农夫山泉','SKU-NONGFU',  2.00, 550),
 (7,'润田','SKU-RUNTIAN',  1.50, 550),
 (8,'酸奶','SKU-YOGURT',  4.00, 250);

INSERT IGNORE INTO `device` (`id`,`name`,`location`,`online`) VALUES
 ('D01-F1','1号柜','教学楼A栋1层',1);

INSERT IGNORE INTO `stock` (`device_id`,`product_id`,`qty`,`threshold`) VALUES
 ('D01-F1',2,10,1),('D01-F1',6,10,1),('D01-F1',7,10,1),('D01-F1',8,10,1);
-- =========================================================
-- 楼层抓拍图片（开门/关门）相关表 — 2026-06-26 追加，幂等
-- =========================================================

-- 抓拍记录：每次开门/关门每层一张图
CREATE TABLE IF NOT EXISTS `snapshot` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `device_id`   VARCHAR(32)  NOT NULL,
  `floor`       INT          NOT NULL,
  `door_action` VARCHAR(16)  NOT NULL,           -- OPEN / CLOSE
  `file_name`   VARCHAR(128) DEFAULT NULL,        -- 原始文件名
  `file_path`   VARCHAR(255) NOT NULL,            -- 服务器存盘名
  `file_size`   BIGINT       DEFAULT 0,
  `md5`         VARCHAR(64)  DEFAULT NULL,
  `detection_data` TEXT        DEFAULT NULL COMMENT '模型检测结果JSON',
  `detected_at`   DATETIME     DEFAULT NULL COMMENT '检测完成时间',
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dev_time` (`device_id`,`create_time`),
  KEY `idx_floor` (`device_id`,`floor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 设备专用上传 token（免 Basic Auth；一个 token 绑一台设备）
CREATE TABLE IF NOT EXISTS `device_token` (
  `token`       VARCHAR(64)  NOT NULL,
  `device_id`   VARCHAR(32)  NOT NULL,
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 1,
  `create_time` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 种子：D01/D02 的上传 token（联调用，正式上线请轮换）
INSERT IGNORE INTO `device_token` (`token`,`device_id`,`enabled`) VALUES
 ('snap_dev_D01_2026','D01-F1',1);
