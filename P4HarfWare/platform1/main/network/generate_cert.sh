#!/bin/bash
# 为 ESP32 固件生成自签名服务器证书
# 固件编译需要此证书做 TLS 校验，部署前必须执行一次。
#
# 用法:
#   cd P4HarfWare/platform1/main/network
#   bash generate_cert.sh <服务器IP或域名>
#
# 示例:
#   bash generate_cert.sh 192.168.1.100

set -e

SERVER_IP="${1:-your-server-ip}"

if [ "$SERVER_IP" = "your-server-ip" ]; then
    echo "请指定服务器 IP 或域名: bash generate_cert.sh <服务器IP>"
    exit 1
fi

echo "为 $SERVER_IP 生成自签名证书..."

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout server_key.pem \
    -out server_cert.pem \
    -days 3650 \
    -subj "/C=CN/ST=GD/L=GZ/O=RetailCloud/CN=$SERVER_IP"

echo "已生成: server_cert.pem (证书) 和 server_key.pem (私钥)"
echo "私钥请勿提交到 git，证书用于固件编译。"
