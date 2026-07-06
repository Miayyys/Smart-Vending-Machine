#!/bin/bash

# 测试服务器API是否可访问
# 使用前修改 your-server-ip 为实际服务器地址
S="your-server-ip"

echo "测试服务器状态..."
curl -I http://$S:80/api

echo -e "\n\n测试商品API..."
curl -I http://$S:80/api/products

echo -e "\n\n测试HTTPS证书..."
openssl s_client -connect $S:443 -servername $S </dev/null 2>/dev/null | openssl x509 -text | grep -A 5 "Subject Alternative Name"

echo -e "\n\n测试API响应..."
curl -s http://$S:80/api/products | head -n 20
