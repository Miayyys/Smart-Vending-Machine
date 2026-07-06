#!/bin/bash

# 导入自签名证书到信任列表
echo "正在导入自签名证书..."

# 创建临时目录
mkdir -p /tmp/certs

# 假设证书在当前目录
if [ -f "selfsigned.crt" ]; then
    echo "找到证书文件: selfsigned.crt"

    # Windows系统导入证书
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        echo "Windows系统，请手动导入证书："
        echo "1. 双击 selfsigned.crt"
        echo "2. 选择'安装证书'"
        echo "3. 选择'当前用户'或'计算机'"
        echo "4. 选择'将所有的证书都放入下列存储'"
        echo "5. 选择'受信任的根证书颁发机构'"
        echo "6. 点击'确定'"
    fi
else
    echo "未找到证书文件 selfsigned.crt"
    echo "请确保证书文件在当前目录"
fi

echo "证书导入完成"