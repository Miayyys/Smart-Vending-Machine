#!/usr/bin/env python3
"""测试API连接 — 部署前修改 your-server-ip 和凭证"""
import requests

SERVER = "http://your-server-ip"
AUTH_HEADER = {"Authorization": "Basic <your-base64-credentials>"}

def test_api():
    try:
        print("=== 测试API连接 ===")

        print("1. 测试基本连接...")
        response = requests.get(SERVER, timeout=5)
        print(f"   状态码: {response.status_code}")

        print("\n2. 测试API端点...")
        response = requests.get(SERVER + "/api", timeout=5)
        print(f"   状态码: {response.status_code}")

        print("\n3. 测试带认证的请求...")
        response = requests.get(SERVER + "/api/products", headers=AUTH_HEADER, timeout=5)
        print(f"   状态码: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   商品数量: {len(data) if isinstance(data, list) else 'N/A'}")

    except Exception as e:
        print(f"错误: {e}")

if __name__ == "__main__":
    test_api()
