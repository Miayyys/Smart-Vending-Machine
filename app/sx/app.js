// app.js
App({
  onLaunch: function () {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // 获取系统信息
    wx.getSystemInfo({
      success: res => {
        this.globalData.systemInfo = res
        // 设置全局状态栏高度
        this.globalData.statusBarHeight = res.statusBarHeight || 0
        // 设置胶囊按钮信息
        this.globalData.menuButtonInfo = res.windowWidth > 750 ? {
          width: 88,
          height: 32,
          top: res.statusBarHeight + 4,
          right: res.windowWidth - 12
        } : {
          width: 96,
          height: 32,
          top: res.statusBarHeight,
          right: 8
        }
      }
    })

    // 检查网络状态
    wx.getNetworkType({
      success: res => {
        this.globalData.networkType = res.networkType
      }
    })

    // 兼容的网络状态监听（如果 onNetworkChange 可用）
    if (typeof wx.onNetworkChange === 'function') {
      wx.onNetworkChange(res => {
        this.globalData.networkType = res.networkType
        wx.showToast({
          title: `网络已切换至${res.networkType}`,
          icon: 'none'
        })
      })
    }

    // 服务器地址 — 部署时修改为实际服务器 IP 或域名
    this.globalData.apiBase = 'http://your-server-ip/api'
    // 移动端API地址（不包含 /api 前缀）
    this.globalData.mobileApiBase = 'http://your-server-ip'
    console.log('环境：使用HTTP（统一）')

    // 初始化用户认证状态
    this.initAuth()

    // 检查是否需要登录
    this.checkLogin()
  },

  // 检查是否需要登录
  checkLogin: function() {
    const userId = wx.getStorageSync('userId')
    const userInfo = wx.getStorageSync('userInfo')
    const token = wx.getStorageSync('token')

    console.log('检查登录状态:', { userId, userInfo: !!userInfo, token: !!token })

    // 如果没有用户信息，需要登录
    if (!userInfo) {
      console.log('没有用户信息，跳转到登录页')
      // 延迟跳转，确保页面已经初始化
      setTimeout(() => {
        const pages = getCurrentPages()
        if (pages.length > 0 && pages[0].route !== 'pages/login/login') {
          wx.redirectTo({
            url: '/pages/login/login'
          })
        }
      }, 100)
    } else {
      console.log('已有用户信息，正常登录')
    }
  },

  onShow: function () {
    // 页面显示时的逻辑
  },

  onHide: function () {
    // 页面隐藏时的逻辑
  },

  onError: function (msg) {
    console.error('App Error:', msg)
  },

  // 全局数据
  globalData: {
    systemInfo: null,
    statusBarHeight: 0,
    menuButtonInfo: null,
    networkType: 'unknown',
    userId: null,
    apiBase: 'http://your-server-ip/api',
    mobileApiBase: 'http://your-server-ip/api/mobile',
    // Basic Auth 凭证 — 部署时修改为实际密码, 或将 base64 编码替换
    adminAuth: 'Basic <your-base64-encoded-credentials>',
  },

  // 初始化用户认证状态
  initAuth: function() {
    const userId = wx.getStorageSync('userId')
    const userInfo = wx.getStorageSync('userInfo')
    const token = wx.getStorageSync('token')

    if (userId && userInfo && token) {
      this.globalData.userId = userId
      this.globalData.userInfo = userInfo
      this.globalData.token = token
    } else if (!userId) {
      // 生成UUID作为用户ID（匿名用户）
      const newUserId = this.generateUUID()
      wx.setStorageSync('userId', newUserId)
      this.globalData.userId = newUserId
    }
  },

  // 生成UUID
  generateUUID: function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  },

  // 网络请求封装（HTTP）
  request: function(options) {
    const that = this
    const { url, method = 'GET', data, header = {}, showLoading = true, loadingText = '加载中...' } = options

    // 合并请求头
    const headers = {
      'content-type': 'application/json',
      'Authorization': that.globalData.adminAuth,
      ...header
    }

    // 显示加载提示
    if (showLoading) {
      wx.showLoading({
        title: loadingText,
        mask: true
      })
    }

    return new Promise((resolve, reject) => {
      wx.request({
        url: that.globalData.apiBase + url,
        method: method,
        data: data,
        header: headers,
        success: function(res) {
          if (res.statusCode === 200) {
            resolve(res.data)
          } else if (res.statusCode === 401) {
            // 未授权，跳转到登录页
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
          console.error('请求失败:', error)
          console.log('错误码:', error.errNo)
          console.log('错误信息:', error.errMsg)
          wx.showToast({
            title: '网络请求失败',
            icon: 'none'
          })
          reject(error)
        },
        complete: function() {
          if (showLoading) {
            wx.hideLoading()
          }
        }
      })
    })
  },

  // 移动端网络请求（无鉴权）
  mobileRequest: function(options) {
    const that = this
    const { url, method = 'GET', data, header = {}, showLoading = true, loadingText = '加载中...' } = options

    // 合并请求头
    const headers = {
      'content-type': 'application/json',
      'Authorization': that.globalData.adminAuth, // 添加 Basic Auth 认证
      ...header
    }

    // 显示加载提示
    if (showLoading) {
      wx.showLoading({
        title: loadingText,
        mask: true
      })
    }

    return new Promise((resolve, reject) => {
      wx.request({
        url: that.globalData.mobileApiBase + url,
        method: method,
        data: data,
        header: headers,
        success: function(res) {
          if (res.statusCode === 200) {
            resolve(res.data)
          } else if (res.statusCode === 401) {
            // 未授权，清除用户信息
            that.clearAuth()
            wx.showToast({
              title: '登录已过期，请重新登录',
              icon: 'none'
            })
            reject(new Error('未授权'))
          } else {
            reject(new Error(res.data.message || '请求失败'))
          }
        },
        fail: function(error) {
          console.error('请求失败:', error)
          wx.showToast({
            title: '网络请求失败',
            icon: 'none'
          })
          reject(error)
        },
        complete: function() {
          if (showLoading) {
            wx.hideLoading()
          }
        }
      })
    })
  },

  // 清除用户认证信息
  clearAuth: function() {
    this.globalData.userInfo = null
    this.globalData.userId = this.generateUUID()
    this.globalData.token = null
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('token')
    wx.setStorageSync('userId', this.globalData.userId)
  },

  // 格式化金额
  formatPrice: function(price) {
    return price.toFixed(2)
  },

  // 格式化日期
  formatDate: function(date) {
    const d = new Date(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hour = String(d.getHours()).padStart(2, '0')
    const minute = String(d.getMinutes()).padStart(2, '0')
    const second = String(d.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`
  },

  // 格式化时间（只显示时分）
  formatTime: function(date) {
    const d = new Date(date)
    const hour = String(d.getHours()).padStart(2, '0')
    const minute = String(d.getMinutes()).padStart(2, '0')
    return `${hour}:${minute}`
  }
})
