// pages/login/login.js
const app = getApp()

Page({
  data: {
    loading: false,
    error: ''
  },

  onLoad: function (options) {
    // 如果已经登录，直接跳转到首页
    if (app.globalData.userId && app.globalData.userInfo) {
      this.redirectToHome()
    }
  },

  // 微信登录
  onWechatLogin: function() {
    this.setData({ loading: true, error: '' })

    // 先获取微信登录code
    wx.login({
      success: (res) => {
        if (res.code) {
          // 模拟登录成功，不调用后端接口
          this.mockLogin(res.code)
        } else {
          this.setData({
            loading: false,
            error: '获取微信登录code失败'
          })
        }
      },
      fail: (error) => {
        console.error('微信登录失败:', error)
        this.setData({
          loading: false,
          error: '微信登录失败，请重试'
        })
      }
    })
  },

  // 模拟登录
  mockLogin: function(code) {
    // 模拟网络延迟
    setTimeout(() => {
      // 生成用户信息
      const userInfo = {
        nickName: '微信用户',
        avatarUrl: ''
      }

      // 生成或使用现有的用户ID
      let userId = wx.getStorageSync('userId')
      if (!userId) {
        userId = this.generateUserId()
        wx.setStorageSync('userId', userId)
      }

      // 保存到全局状态
      app.globalData.userInfo = userInfo
      app.globalData.userId = userId
      app.globalData.token = 'mock_token_' + Date.now()

      // 保存到本地存储
      wx.setStorageSync('userInfo', userInfo)
      wx.setStorageSync('token', app.globalData.token)

      this.setData({ loading: false })
      this.redirectToHome()
    }, 1500) // 模拟1.5秒的网络延迟
  },

  // 生成用户ID
  generateUserId: function() {
    const timestamp = Date.now()
    const random = Math.floor(Math.random() * 10000)
    return 'wx_' + timestamp + '_' + random
  },

  // 跳转到首页
  redirectToHome: function() {
    wx.reLaunch({
      url: '/pages/index/index'
    })
  },

  // 分享
  onShareAppMessage: function () {
    return {
      title: '校园智能柜',
      path: '/pages/login/login'
    }
  },

  // 显示用户协议
  showTerms: function() {
    wx.showModal({
      title: '用户协议',
      content: '欢迎使用校园智能柜！\n\n1. 本服务仅限校园内使用\n2. 请妥善保管个人物品\n3. 遵守使用规则和注意事项\n4. 如有问题请联系客服',
      showCancel: true,
      confirmText: '我已阅读并同意',
      cancelText: '取消'
    })
  }
})