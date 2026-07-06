#!/bin/bash

# 检查证书文件
echo "=== 证书文件检查 ==="
if [ -f "selfsigned.crt" ]; then
    echo "✓ 找到证书文件: selfsigned.crt"
    echo "证书信息:"
    openssl x509 -in selfsigned.crt -text -noout | grep -E "(Subject:|Issuer:|DNS:|Not Before|Not After)"
else
    echo "✗ 未找到证书文件"
fi

if [ -f "selfsigned.key" ]; then
    echo "✓ 找到私钥文件: selfsigned.key"
else
    echo "✗ 未找到私钥文件，需要生成"
    echo "正在生成私钥..."
    openssl genrsa -out selfsigned.key 2048
    echo "私钥已生成"
fi

echo ""
echo "=== 测试HTTPS连接 ==="
echo "请修改 your-server-ip 为实际服务器地址后取消注释:"
echo "# openssl s_client -connect your-server-ip:443 -verify_return_error < /dev/null"

echo ""
echo "=== 服务器配置建议 ==="
echo "如果还没有运行HTTPS服务器，请运行以下命令："
echo ""
echo "Node.js服务器："
echo "node https_server.js"
echo ""
echo "或使用Python HTTPS服务器："
echo "python3 https_server.py"
