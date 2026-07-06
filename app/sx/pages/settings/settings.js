// pages/settings/settings.js
const app = getApp()

Page({
  data: {
    settings: {
      notifications: true,
      autoRefresh: true,
      cacheEnabled: true
    },
    apiConfig: {
      baseUrl: '',
      mobileApiUrl: ''
    },
    userInfo: {
      nickname: '微信用户',
      userId: '',
      lastLogin: ''
    },
    loading: false
  },

  onLoad: function (options) {
    this.setData({
      apiConfig: {
        baseUrl: app.globalData.apiBase,
        mobileApiUrl: app.globalData.mobileApiBase
      }
    })
    this.loadUserInfo()
    this.loadSettings()
  },

  onShow: function () {
    // 页面显示时刷新数据
  },

  // 加载用户信息
  loadUserInfo: function() {
    const userId = app.globalData.userId
    const lastLogin = app.formatDate(new Date())

    this.setData({
      userInfo: {
        nickname: '微信用户',
        userId: userId,
        lastLogin: lastLogin
      }
    })
  },

  // 加载设置
  loadSettings: function() {
    const settings = wx.getStorageSync('settings') || {
      notifications: true,
      autoRefresh: true,
      cacheEnabled: true
    }
    this.setData({
      settings: settings
    })
  },

  // 保存设置
  saveSettings: function() {
    wx.setStorageSync('settings', this.data.settings)
    wx.showToast({
      title: '设置已保存',
      icon: 'success'
    })
  },

  // 切换通知设置
  toggleNotification: function() {
    this.setData({
      'settings.notifications': !this.data.settings.notifications
    }, this.saveSettings)
  },

  // 切换自动刷新
  toggleAutoRefresh: function() {
    this.setData({
      'settings.autoRefresh': !this.data.settings.autoRefresh
    }, this.saveSettings)
  },

  // 切换缓存
  toggleCache: function() {
    this.setData({
      'settings.cacheEnabled': !this.data.settings.cacheEnabled
    }, this.saveSettings)
  },

  // 清除缓存
  clearCache: function() {
    wx.showModal({
      title: '清除缓存',
      content: '确定要清除所有缓存数据吗？',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorage()
          wx.showToast({
            title: '缓存已清除',
            icon: 'success'
          })
        }
      }
    })
  },

  // 关于我们
  showAbout: function() {
    wx.showModal({
      title: '关于校园智能柜',
      content: '版本：v1.0.0\n\n这是一个基于微信小程序的校园无人零售系统，提供便捷的自助购物体验。\n\n开发团队：校园智能柜项目组\n\n© 2026 版权所有',
      showCancel: false
    })
  },

  // 用户协议
  showUserAgreement: function() {
    wx.showModal({
      title: '用户协议',
      content: '使用本小程序即表示您同意用户协议条款...',
      showCancel: false
    })
  },

  // 隐私政策
  showPrivacyPolicy: function() {
    wx.showModal({
      title: '隐私政策',
      content: '我们重视您的隐私保护...',
      showCancel: false
    })
  },

  // 退出登录
  logout: function() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          // 清除用户信息
          wx.removeStorageSync('userId')
          wx.removeStorageSync('batchId')
          wx.removeStorageSync('settings')

          // 清除全局用户信息
          app.globalData.userInfo = null
          app.globalData.token = null
          app.clearAuth()

          wx.showToast({
            title: '已退出登录',
            icon: 'success'
          })

          // 跳转到首页
          wx.reLaunch({
            url: '/pages/index/index'
          })
        }
      }
    })
  },

  // 返回
  goBack: function() {
    wx.navigateBack()
  },

  // 分享
  onShareAppMessage: function () {
    return {
      title: '设置',
      path: '/pages/settings/settings'
    }
  }
})