const https = require('https');
const fs = require('fs');
const path = require('path');

// 读取证书文件
const certPath = path.join(__dirname, 'selfsigned.crt');
const keyPath = path.join(__dirname, 'selfsigned.key');

console.log('=== 证书文件检查 ===');
console.log('证书文件:', certPath);
console.log('私钥文件:', keyPath);

if (fs.existsSync(certPath)) {
    console.log('✓ 找到证书文件');
} else {
    console.log('✗ 未找到证书文件');
    process.exit(1);
}

if (fs.existsSync(keyPath)) {
    console.log('✓ 找到私钥文件');
} else {
    console.log('✗ 未找到私钥文件，需要生成');
    // 生成私钥
    const { execSync } = require('child_process');
    execSync('openssl genrsa -out selfsigned.key 2048');
    console.log('私钥已生成');
}

// HTTPS选项
const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
};

// 创建HTTPS服务器
const server = https.createServer(options, (req, res) => {
    console.log(`收到请求: ${req.method} ${req.url}`);

    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API路由
    if (req.url === '/api/products') {
        // 返回商品数据
        const products = [
            { id: 1, name: '矿泉水', price: 2.00, sku: 'WATER-001', deviceId: 'D01' },
            { id: 2, name: '可乐', price: 3.50, sku: 'COLA-001', deviceId: 'D01' },
            { id: 3, name: '薯片', price: 5.00, sku: 'CHIP-001', deviceId: 'D01' },
            { id: 4, name: '面包', price: 4.50, sku: 'BREAD-001', deviceId: 'D01' },
            { id: 5, name: '咖啡', price: 6.00, sku: 'COFFEE-001', deviceId: 'D01' }
        ];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(products));
    } else if (req.url === '/api' && req.method === 'POST') {
        // 处理开门请求
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                batchId: 'batch_' + Date.now(),
                message: '门已开启'
            }));
        });
    } else {
        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const SERVER_IP = 'your-server-ip';

// 启动服务器
const PORT = 443;
server.listen(PORT, () => {
    console.log(`\n🚀 HTTPS服务器已启动！`);
    console.log(`📍 地址: https://${SERVER_IP}:${PORT}`);
    console.log(`🔒 使用自签名证书`);
    console.log(`\n测试命令:`);
    console.log(`curl -k https://${SERVER_IP}:443/api/products`);
    console.log(`\n按 Ctrl+C 停止服务器`);
});

// 错误处理
server.on('error', (err) => {
    console.error('服务器错误:', err);
});