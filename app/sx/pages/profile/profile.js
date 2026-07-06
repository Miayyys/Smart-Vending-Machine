// pages/profile/profile.js
const app = getApp()

Page({
  data: {
    userInfo: {
      nickName: '微信用户',
      avatarUrl: '/images/avatar-default.png'
    },
    userId: '',
    orderStats: {
      total: 0,
      unpaid: 0,
      paid: 0
    },
    loading: true,
    error: null
  },

  onLoad: function (options) {
    // 检查登录状态
    this.checkAuth()
    // 加载用户信息
    this.loadUserInfo()
  },

  onShow: function () {
    // 页面显示时刷新数据
    this.loadOrderStats()
  },

  // 检查认证状态
  checkAuth: function() {
    const app = getApp()
    if (!app.globalData.userId || !app.globalData.userInfo) {
      wx.showModal({
        title: '请先登录',
        content: '使用智能柜需要登录后才能继续',
        showCancel: false,
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.redirectTo({ url: '/pages/login/login' })
          }
        }
      })
    }
  },

  // 加载用户信息
  loadUserInfo: function() {
    const app = getApp()

    // 使用全局用户信息
    const userInfo = app.globalData.userInfo || {
      nickName: '微信用户',
      avatarUrl: ''
    }

    this.setData({
      userInfo: userInfo,
      userId: app.globalData.userId || '未登录'
    })

    // 加载订单统计
    this.loadOrderStats()
  },

  // 加载订单统计
  loadOrderStats: function() {
    const userId = app.globalData.userId

    if (!userId) {
      this.setData({
        orderStats: {
          total: 0,
          unpaid: 0,
          paid: 0
        },
        loading: false
      })
      return
    }

    wx.request({
      url: app.globalData.mobileApiBase + `/api/mobile/orders?userId=${userId}&limit=1`,
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        if (res.statusCode === 200) {
          const orders = Array.isArray(res.data) ? res.data : []
          const stats = {
            total: orders.length,
            unpaid: orders.filter(item => item.payStatus === 'UNPAID').length,
            paid: orders.filter(item => item.payStatus === 'PAID').length
          }
          this.setData({
            orderStats: stats,
            loading: false
          })
        } else {
          this.setData({
            orderStats: {
              total: 0,
              unpaid: 0,
              paid: 0
            },
            loading: false
          })
        }
      },
      fail: (error) => {
        console.error('加载订单统计失败:', error)
        this.setData({
          orderStats: {
            total: 0,
            unpaid: 0,
            paid: 0
          },
          loading: false
        })
      }
    })
  },

  // 设置
  goToSettings: function() {
    wx.navigateTo({
      url: '/pages/settings/settings'
    })
  },

  // 关于我们
  goToAbout: function() {
    wx.showModal({
      title: '关于校园智能柜',
      content: '这是一个基于微信小程序的校园无人零售系统，提供便捷的自助购物体验。\n\n版本：1.0.0\n开发团队：校园创新实验室',
      showCancel: false,
      confirmText: '确定'
    })
  },

  // 复制用户ID
  copyUserId: function() {
    const userId = this.data.userId
    wx.setClipboardData({
      data: userId,
      success: function() {
        wx.showToast({
          title: '已复制到剪贴板',
          icon: 'success'
        })
      }
    })
  },

  // 退出登录
  logout: function() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()

          // 清除用户信息
          app.globalData.userInfo = null
          app.globalData.token = null

          // 保存匿名用户ID
          const anonymousUserId = app.generateUUID()
          app.globalData.userId = anonymousUserId
          wx.setStorageSync('userId', anonymousUserId)
          wx.removeStorageSync('userInfo')
          wx.removeStorageSync('token')

          // 跳转到登录页
          wx.redirectTo({
            url: '/pages/login/login'
          })
        }
      }
    })
  },

  // 分享
  onShareAppMessage: function () {
    return {
      title: '校园智能柜 - 我的',
      path: '/pages/profile/profile'
    }
  }
})