// utils/cert.js

// 自签名证书 Base64 — 部署时替换为实际服务器证书
// 生成命令: openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=your-server-ip"
// 然后将 cert.pem 内容 base64 编码替换下方 CERT_BASE64
const CERT_BASE64 = `<your-certificate-base64>`;

// 将证书转成 PEM 格式
function getPEM() {
  return `-----BEGIN CERTIFICATE-----\n${CERT_BASE64}\n-----END CERTIFICATE-----`;
}

// 自定义证书请求
function requestWithCert(options) {
  const app = getApp()
  const { url, method = 'GET', data, header = {}, showLoading = false, loadingText = '加载中...' } = options

  // 添加自定义证书
  const headers = {
    'content-type': 'application/json',
    'Authorization': app.globalData.adminAuth,
    // 自定义证书请求头（实验性）
    'X-Custom-Cert': CERT_BASE64,
    ...header
  }

  if (showLoading) {
    wx.showLoading({
      title: loadingText,
      mask: true
    })
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + url,
      method: method,
      data: data,
      header: headers,
      // 尝试使用客户端证书（某些系统版本可能支持）
      enableHttps: true,
      success: function(res) {
        if (res.statusCode === 200) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          wx.showToast({
            title: '请重新登录',
            icon: 'none'
          })
          reject(new Error('未授权'))
        } else {
          reject(new Error(res.data.message || '请求失败'))
        }
      },
      fail: function(error) {
        console.error('HTTPS 请求失败:', error)

        // 如果是证书错误，自动降级到 HTTP
        if (error.errNo === 600001 || error.errMsg.includes('证书') || error.errMsg.includes('ERR_CERT_AUTHORITY_INVALID')) {
          console.log('证书失败，自动降级到 HTTP')
          wx.request({
            url: app.globalData.apiBase.replace('https://', 'http://') + url,
            method: method,
            data: data,
            header: {
              'content-type': 'application/json',
              'Authorization': app.globalData.adminAuth,
              ...header
            },
            success: function(httpRes) {
              if (httpRes.statusCode === 200) {
                resolve(httpRes.data)
              } else {
                reject(httpRes)
              }
            },
            fail: function(httpError) {
              console.error('HTTP 也失败了:', httpError)
              wx.showToast({
                title: '网络请求失败',
                icon: 'none'
              })
              reject(httpError)
            },
            complete: function() {
              if (showLoading) {
                wx.hideLoading()
              }
            }
          })
        } else {
          wx.showToast({
            title: '网络请求失败',
            icon: 'none'
          })
          reject(error)
        }
      },
      complete: function() {
        if (showLoading) {
          wx.hideLoading()
        }
      }
    })
  })
}

module.exports = {
  getPEM,
  requestWithCert
}