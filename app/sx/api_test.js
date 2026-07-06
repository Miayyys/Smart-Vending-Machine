// API测试工具 — 部署前修改 your-server-ip 和凭证
const TEST_SERVER = 'http://your-server-ip';
const TEST_AUTH = 'Basic <your-base64-credentials>';

const testAPI = async () => {
  try {
    console.log('测试API连接...')

    const response1 = await wx.request({
      url: TEST_SERVER + '/api/products',
      method: 'GET'
    })
    console.log('未认证响应:', response1)

    const response2 = await wx.request({
      url: TEST_SERVER + '/api/products',
      method: 'GET',
      header: { 'Authorization': TEST_AUTH }
    })
    console.log('认证响应:', response2)

  } catch (error) {
    console.error('API测试失败:', error)
  }
}

testAPI()
