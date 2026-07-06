#!/bin/bash

# 测试服务器配置
# 使用前修改 YOUR_SERVER_IP 为实际服务器地址
S="your-server-ip"

echo "=== 服务器配置测试 ==="

# 1. 测试HTTP端口
echo "1. 测试HTTP端口80..."
curl -I http://$S:80 --connect-timeout 5
echo -e "\n"

# 2. 测试HTTP API
echo "2. 测试HTTP API..."
curl -I http://$S:80/api --connect-timeout 5
echo -e "\n"

# 3. 测试商品API（带认证）
echo "3. 测试商品API（带认证）..."
echo "请修改 Authorization header 为实际的 Basic Auth 凭证"
# curl -H "Authorization: Basic <your-base64-credentials>" http://$S:80/api/products --connect-timeout 5
echo -e "\n"

# 4. 检查端口
echo "4. 检查开放端口..."
netstat -an | grep :80
echo -e "\n"

echo "=== 测试完成 ==="
