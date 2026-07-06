# 校园无人零售柜 — 云平台服务器端

阿里云轻量服务器 `<server-ip>`，<username> 主动维护。Docker Compose 一体化编排：
**EMQX(MQTT) + MySQL 8 + Spring Boot API**。本项目三服务全部装在 `~/retail-cloud/`，
不污染系统目录，`docker compose down -v` 可整体拆除，不影响 user2/user3。

## 一、起停
```bash
cd ~/retail-cloud
docker compose up -d --build      # 首次：会拉镜像 + 编译后端，约 3-5 分钟
docker compose ps                 # 看健康
docker compose logs -f backend    # 跟后端日志
docker compose down               # 停（保数据）
docker compose down -v            # 停并删数据卷（彻底重置）
```

## 二、端口与账号（默认仅 127.0.0.1，公网放行见第七节）
| 服务 | 端口(本机) | 用途 |
|---|---|---|
| EMQX MQTT | 127.0.0.1:1883 | 设备/可视化 |
| EMQX Dashboard | 127.0.0.1:18083 | 管理台 |
| MySQL | 127.0.0.1:3306 | 业务库 |
| Backend REST | 127.0.0.1:8080 | API |

**账号**（见 `.env`，已 chmod 600，勿提交）：
- MySQL root / app 用户：见 `.env`
- EMQX Dashboard：`admin / <emqx-dashboard-password>`（默认）
- EMQX MQTT 账号（启用鉴权后）：`retail_ui / <mqtt-ui-password>`、`retail_device / <mqtt-device-password>`

## 三、先做这一步：启用 EMQX 账号鉴权（必做，否则 1883 裸奔）
首次 `compose up` 后执行一次（幂等）：
```bash
cd ~/retail-cloud
docker compose exec emqx sh /opt/emqx/init-users.sh
# 或从宿主机直连 dashboard API：
bash emqx/init-users.sh
```
> 备注：`init-users.sh` 走 Dashboard REST API 增加 built_in_database 认证器与两对账号。
> 若 REST 路径随版本变化报 404，可在 Dashboard(http://127.0.0.1:18083) 的
> "访问控制→认证" 里手动加 `password_based:built_in_database` 并加这两个用户。

## 四、MQTT 主题约定
```
retail/<device>/telemetry/weight   {"w":1234,"ts":...}            周期重量
retail/<device>/event/take         {"pid":1,"act":"TAKE","qty":1,"w":550,"ts":...}  拿取/放回
retail/<device>/event/settle       {"uid":"u1","amount":3.5,"status":"PAID"}        结算
retail/<device>/event/anomaly      {"type":"UNPAID_OPEN","level":"WARN"}            异常
```
发布需带 MQTT 账号（`retail_ui` 或 `retail_device`）。

## 五、REST API 速查（前缀 /api）
| Method | Path | 作用 |
|---|---|---|
| GET | /api/health | 存活探针 |
| GET | /api/products | 商品列表 |
| GET | /api/devices/{id}/stock | 该柜实时库存 |
| GET | /api/stock/low | 低库存清单 |
| POST| /api/stock/reconcile?deviceId=&productId=&qty=&threshold= | 对齐库存(测试,可触补货) |
| GET | /api/orders?deviceId= | 历史订单 |
| POST| /api/orders | 创建/结算单 |
| GET | /api/alerts/restock?status=PENDING | 补货提醒 |
| POST| /api/alerts/restock/{id}/ack | 确认补货 |
| GET | /api/alerts/anomaly?unhandledOnly=true | 异常预警 |
| POST| /api/alerts/anomaly | 上报异常 |

## 六、端到端联调（本机 127.0.0.1，装个 mosquitto 客户端）
```bash
# 1) 健康检查
curl -s 127.0.0.1:8080/api/health
# 2) 模拟拿取事件：D01 拿走 1 个 pid=3 的薯片(库存只 2，触发补货)
mosquitto_pub -h 127.0.0.1 -p 1883 -u retail_ui -P <mqtt-ui-password> \
  -t retail/D01/event/take -m '{"pid":3,"act":"TAKE","qty":1}'
# 触发后查补货告警
curl -s '127.0.0.1:8080/api/alerts/restock'
# 3) 模拟异常
mosquitto_pub -h 127.0.0.1 -p 1883 -u retail_ui -P <mqtt-ui-password> \
  -t retail/D01/event/anomaly -m '{"type":"UNPAID_OPEN","level":"WARN"}'
curl -s '127.0.0.1:8080/api/alerts/anomaly'
# 4) 资源复检
docker stats --no-stream
```

## 七、对公网开放（联调通过后再做）
1. 登阿里云轻量服务器控制台 → 防火墙/安全组，放行：
   - `1883/TCP`（MQTT，已配账号鉴权，建议再加办公 IP 限定）
   - `8080/TCP`（REST，二期上可视化站后可只对站点反代/白名单）
2. 改 `docker-compose.yml` 把 `127.0.0.1:` 前缀去掉对应端口（如确需公网直连）。
3. **不建议**对公网开放 `3306`、`18083`；如需 Dashboard 远程访问，加 Basic Auth 或仅办公 IP。
4. 二期可上 8883(TLS)，设备端配证书。

## 八、内存占用说明
服务器 1.6GB RAM + 4GB swap。各服务 mem_limit：EMQX 450m / MySQL 400m / Backend 400m。
若 `docker stats` 总占接近物理内存导致 OOM，降级方案：EMQX 关 Dashboard，或换
mosquitto(~10MB)。

## 九、数据位置
- MySQL 数据卷：`~/retail-cloud/mysql/data/`（bind mount，`down` 不删，`down -v` 注意此 bind 不受 -v 控制，要删需手工 rm）
- EMQX 数据/日志：named volume `emqx-data` / `emqx-log`（`down -v` 才删）

## 十、目录速览
```
~/retail-cloud/
├── docker-compose.yml
├── .env                  # 机密，600
├── emqx/init-users.sh    # 启用内置账号鉴权
├── mysql/conf/my.cnf     # 小内存调优
├── mysql/init/01-schema.sql  # 建表 + 种子数据
└── backend/              # Spring Boot 源码 + Dockerfile
```