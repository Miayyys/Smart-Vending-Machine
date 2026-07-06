#!/bin/sh
# EMQX 5.x 内置账号鉴权初始化（幂等）
# 流程：用 Dashboard 管理员账号登录拿 JWT -> 启用 built_in_database 认证器 -> 加两个用户。
# 环境变量（由 .env 经 compose 注入）：
#   EMQX_DASHBOARD_USERNAME / EMQX_DASHBOARD_PASSWORD  Dashboard 登录账号
#   EMQX_UI_USERNAME     / EMQX_UI_PASSWORD         后端/可视化用的 MQTT 账号
#   EMQX_DEV_USERNAME   / EMQX_DEV_PASSWORD        设备端的 MQTT 账号
# 可在宿主机或容器内执行：参数为 EMQX 的 host:port（默认 127.0.0.1:18083）。
set -e
HOST="${EMQX_HOST:-127.0.0.1}"
PORT="${EMQX_PORT:-18083}"
BASE="http://${HOST}:${PORT}/api/v5"

DUSER="${EMQX_DASHBOARD_USERNAME:-admin}"
DPASS="${EMQX_DASHBOARD_PASSWORD}"
UI_USER="${EMQX_UI_USERNAME}"; UI_PASS="${EMQX_UI_PASSWORD}"
DEV_USER="${EMQX_DEV_USERNAME}"; DEV_PASS="${EMQX_DEV_PASSWORD}"

AUTHID="password_based:built_in_database"

echo "[init-users] login dashboard..."
TOKEN=$(curl -s -m 10 -X POST "$BASE/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$DUSER\",\"password\":\"$DPASS\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "[init-users] login FAIL"; exit 1; }
AUTH="Authorization: Bearer $TOKEN"

echo "[init-users] enabling built-in authentication..."
# 创建认证器（已存在会返回错误，忽略）
curl -s -o /dev/null -w "create=%{http_code}\n" -H "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$BASE/authentication" \
  -d '{"mechanism":"password_based","backend":"built_in_database","password_hash_algorithm":{"name":"sha256","salt_position":"suffix"}}' || true

add_user() {
  local u="$1" p="$2"
  # 先尝试更新（PUT 用户），失败则创建（POST）
  code=$(curl -s -o /tmp/u.out -w "%{http_code}" -H "$AUTH" -H 'Content-Type: application/json' \
    -X PUT "$BASE/authentication/$AUTHID/users/$u" \
    -d "{\"user_id\":\"$u\",\"password\":\"$p\",\"is_superuser\":true}")
  if [ "$code" = "404" ] || [ "$code" = "400" ]; then
    code=$(curl -s -o /tmp/u.out -w "%{http_code}" -H "$AUTH" -H 'Content-Type: application/json' \
      -X POST "$BASE/authentication/$AUTHID/users" \
      -d "{\"user_id\":\"$u\",\"password\":\"$p\",\"is_superuser\":true}")
  fi
  echo "add $u -> $code"
}

echo "[init-users] adding mqtt users..."
add_user "$UI_USER" "$UI_PASS"
add_user "$DEV_USER" "$DEV_PASS"

# 关闭匿名连接（开启鉴权后匿名应被禁止；显式置 deny 更保险）
# EMQX 5.x: authorization + authentication.no_authentication? 由认证器存在即禁止匿名
echo "[init-users] current authentication:"
curl -s -m8 -H "$AUTH" "$BASE/authentication" | head -c 400
echo
echo "[init-users] DONE. test: mosquitto_pub -h <host> -p 1883 -u $UI_USER -P <pw> -t retail/D01/event/take -m '{...}'"