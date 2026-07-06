// 在微信开发者工具控制台运行这个脚本来测试API连接
// 部署前修改 your-server-ip 和凭证
const TEST_SERVER = 'http://your-server-ip';
const TEST_AUTH = 'Basic <your-base64-credentials>';

const testAPI = () => {
  console.log('=== 开始测试API连接 ===')

  console.log('1. 测试基本连接...')
  wx.request({
    url: TEST_SERVER,
    method: 'GET',
    success: (res) => { console.log('基本连接成功:', res.statusCode) },
    fail: (err) => { console.log('基本连接失败:', err) }
  })

  console.log('2. 测试API端点...')
  wx.request({
    url: TEST_SERVER + '/api',
    method: 'GET',
    success: (res) => { console.log('API端点成功:', res.statusCode, res.header) },
    fail: (err) => { console.log('API端点失败:', err) }
  })

  console.log('3. 测试带认证的请求...')
  wx.request({
    url: TEST_SERVER + '/api/products',
    method: 'GET',
    header: { 'Authorization': TEST_AUTH },
    success: (res) => {
      console.log('商品API成功:', res.statusCode)
      if (res.data) { console.log('商品数据:', res.data) }
    },
    fail: (err) => { console.log('商品API失败:', err) }
  })
}

testAPI()
