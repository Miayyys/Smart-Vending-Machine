// 修改请求配置以处理自签名证书（仅开发环境）
const app = getApp()

// 自定义请求函数，处理自签名证书
const requestWithCert = function(options) {
  const that = this

  // 只在开发环境跳过证书验证
  const systemInfo = wx.getSystemInfoSync()
  if (systemInfo.platform === 'devtools' || that.globalData.isDebugMode) {
    // 开发工具中可以使用不验证证书的方式
    return new Promise((resolve, reject) => {
      wx.request({
        url: that.globalData.apiBase + options.url,
        method: options.method || 'GET',
        data: options.data,
        header: options.header || {},
        timeout: options.timeout || 10000,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res)
          } else {
            reject({
              errMsg: `request:fail ${res.statusCode}`,
              errNo: res.statusCode
            })
          }
        },
        fail: (err) => {
          reject(err)
        }
      })
    })
  } else {
    // 真机环境使用正常请求
    return that.request(options)
  }
}

// 添加到app.js
App({
  // ... 其他配置 ...

  // 自定义请求函数
  requestWithCert: requestWithCert,

  // 调用方式
  // this.requestWithCert({ url: '/products' }).then(...)
})