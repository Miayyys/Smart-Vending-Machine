// pages/index/index.js
const app = getApp()

Page({
  data: {
    bannerImage: '', // 暂时不加载图片
    features: [
      {
        title: '商品浏览',
        desc: '查看所有在售商品',
        icon: '📦',
        color: '#1aad19'
      },
      {
        title: '开门购买',
        desc: '一键智能柜开门',
        icon: '🚪',
        color: '#ff9500'
      },
      {
        title: '订单查询',
        desc: '实时查看订单状态',
        icon: '📋',
        color: '#007aff'
      },
      {
        title: '支付结算',
        desc: '多种支付方式',
        icon: '💰',
        color: '#ff2d55'
      }
    ],
    latestOrders: [],
    loading: true,
    error: null
  },

  onLoad: function (options) {
    // 检查登录状态
    this.checkAuth()

    // 加载最新订单
    this.loadLatestOrders()

    // 检查是否有未支付的订单
    this.checkUnpaidOrder()
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
            wx.redirectTo({
              url: '/pages/login/login'
            })
          }
        }
      })
    }
  },

  onShow: function () {
    // 页面显示时刷新数据
    this.loadLatestOrders()
  },

  onPullDownRefresh: function () {
    this.loadLatestOrders().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 加载最新订单
  loadLatestOrders: function() {
    const userId = app.globalData.userId

    if (!userId) {
      console.log('用户ID不存在，跳过最新订单加载')
      this.setData({
        latestOrders: [],
        loading: false
      })
      return
    }

    // 使用正确的移动端 API
    app.mobileRequest({
      url: `/api/mobile/orders?userId=${userId}&limit=5`,
      showLoading: false
    }).then(data => {
      console.log('加载最新订单API响应:', data)

      // 处理不同的数据结构
      let orders = []
      if (Array.isArray(data)) {
        orders = data
      } else if (data && Array.isArray(data.orders)) {
        orders = data.orders
      }

      // 过滤掉无效的订单
      orders = orders.filter(order =>
        order &&
        order.batchId &&
        order.items &&
        Array.isArray(order.items) &&
        order.items.length > 0
      )

      this.setData({
        latestOrders: orders,
        loading: false
      })
      console.log('设置最新订单完成，数量:', orders.length)
    }).catch(error => {
      console.log('加载最新订单失败:', error)
      this.setData({
        error: '加载失败',
        loading: false
      })
    })
  },

  // 检查是否有未支付的订单
  checkUnpaidOrder: function() {
    const userId = app.globalData.userId

    if (!userId) {
      console.log('用户ID不存在，跳过未支付订单检查')
      return
    }

    // 使用正确的移动端 API
    app.mobileRequest({
      url: `/api/mobile/orders?userId=${userId}&limit=1`,
      showLoading: false
    }).then(data => {
      console.log('检查未支付订单API响应:', data)

      // 处理不同的数据结构
      let orders = []
      if (Array.isArray(data)) {
        orders = data
      } else if (data && Array.isArray(data.orders)) {
        orders = data.orders
      }

      // 检查是否有未支付的订单
      const unpaidOrder = orders.find(item =>
        item &&
        item.payStatus === 'UNPAID' &&
        item.items &&
        item.items.length > 0
      )

      if (unpaidOrder) {
        console.log('发现未支付订单:', unpaidOrder)
        wx.showModal({
          title: '待支付订单',
          content: `您有一个订单需要支付，金额：¥${unpaidOrder.totalAmount}`,
          confirmText: '去支付',
          success: (res) => {
            if (res.confirm) {
              this.goToOrdersDetail(unpaidOrder.batchId)
            }
          }
        })
      } else {
        console.log('没有未支付订单')
      }
    }).catch(error => {
      console.log('检查未支付订单失败:', error)
    })
  },

  // 跳转到商品页
  goToProducts: function() {
    wx.switchTab({
      url: '/pages/products/products'
    })
  },

  // 跳转到订单页
  goToOrders: function() {
    wx.switchTab({
      url: '/pages/orders/orders'
    })
  },

  // 跳转到订单详情
  goToOrdersDetail: function(orderId) {
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderId=${orderId}`
    })
  },

  // 获取订单状态标签
  getOrderStatusTag: function(status) {
    const statusMap = {
      'UNPAID': { text: '待支付', color: 'text-warning' },
      'PAID': { text: '已支付', color: 'text-primary' },
      'FAILED': { text: '失败', color: 'text-error' }
    }
    return statusMap[status] || { text: '未知', color: 'text-light' }
  },

  // 获取订单日期
  getOrderDate: function(dateStr) {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now - date
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return '今天'
    } else if (days === 1) {
      return '昨天'
    } else {
      return `${days}天前`
    }
  },

  // 分享
  onShareAppMessage: function () {
    return {
      title: '校园智能柜',
      path: '/pages/index/index'
    }
  },

  // 分享到朋友圈
  onShareTimeline: function () {
    return {
      title: '校园智能柜 - 便捷购物新体验'
    }
  }
})
