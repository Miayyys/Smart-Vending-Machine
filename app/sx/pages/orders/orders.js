// pages/orders/orders.js
const app = getApp()

Page({
  data: {
    orders: [],
    loading: true,
    error: null,
    currentPage: 1,
    hasMore: true
  },

  onLoad: function (options) {
    // 检查登录状态
    this.checkAuth()
    // 加载订单列表
    this.loadOrders()
  },

  onShow: function () {
    // 每次显示页面时刷新数据
    this.loadOrders(true)
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

  // 加载订单列表
  loadOrders: function(background) {
    const userId = app.globalData.userId
    console.log('=== 开始加载订单列表 ===')
    console.log('用户ID:', userId)
    console.log('globalData:', app.globalData)

    if (!userId) {
      console.error('用户ID不存在')
      wx.showModal({
        title: '错误',
        content: '用户ID不存在，请重新登录',
        showCancel: false,
        confirmText: '确定'
      })
      return
    }

    if (!background) {
      this.setData({ loading: true, error: null })
    }
    console.log('开始请求API...')

    // 构建查询参数（去掉 page 参数，先用最简单的方式）
    const url = `/api/mobile/orders?userId=${userId}`
    console.log('请求URL:', app.globalData.mobileApiBase + url)

    // 调用订单历史API
    wx.request({
      url: app.globalData.mobileApiBase + url,
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        console.log('=== API响应详情 ===')
        console.log('响应状态:', res.statusCode)
        console.log('响应数据类型:', typeof res.data)
        console.log('响应数据完整:', JSON.stringify(res.data))
        if (res.data && typeof res.data === 'object') {
          console.log('数据键名:', Object.keys(res.data))
        }

        if (res.statusCode === 200) {
          console.log('订单列表API成功:', res.data)

          // 处理空数据情况
          let newOrders = []
          if (Array.isArray(res.data)) {
            console.log('数据是数组，长度:', res.data.length)
            newOrders = res.data
          } else if (res.data && Array.isArray(res.data.orders)) {
            console.log('数据包含orders数组，长度:', res.data.orders.length)
            newOrders = res.data.orders
          } else if (res.data && Array.isArray(res.data.data)) {
            console.log('数据包含data数组，长度:', res.data.data.length)
            newOrders = res.data.data
          } else if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
            console.log('数据是对象，尝试获取第一个数组字段')
            for (const key in res.data) {
              if (Array.isArray(res.data[key])) {
                console.log('找到数组字段:', key, '长度:', res.data[key].length)
                newOrders = res.data[key]
                break
              }
            }
          }

          console.log('解析后订单数:', newOrders.length)
          if (newOrders.length > 0) {
            console.log('第一个订单字段:', Object.keys(newOrders[0]))
          }

          // 过滤掉无效的订单
          newOrders = newOrders.filter(order => order && (order.id || order.orderId))

          // 预计算显示数据（Skyline 不支持模板三元表达式）
          const formattedOrders = newOrders.map(order => ({
            ...order,
            statusClass: order.payStatus === 'PAID' ? 'paid' : 'unpaid',
            statusText: order.payStatus === 'PAID' ? '已支付' : '待支付',
            summaryText: (order.items && order.items.length > 0)
              ? (order.items[0].productName + (order.items.length > 1 ? ' 等' + order.items.length + '件' : ''))
              : ('共¥' + (order.totalAmount || 0)),
            displayId: order.batchId ? order.batchId.substring(0, 8) : (order.id || order.orderId)
          }))

          this.setData({
            orders: formattedOrders,
            loading: false,
            hasMore: newOrders.length >= 10
          })

          console.log('设置数据完成，订单数量:', formattedOrders.length)
        } else {
          console.error('API返回错误:', res.statusCode)
          this.setData({
            loading: false,
            error: `加载失败，错误码: ${res.statusCode}`
          })
        }
      },
      fail: (error) => {
        console.error('订单列表API失败:', error)
        this.setData({
          loading: false,
          error: '网络连接失败，请重试'
        })
      }
    })
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.setData({
      orders: [],
      currentPage: 1,
      hasMore: true
    })
    this.loadOrders()
    wx.stopPullDownRefresh()
  },

  // 上拉加载更多
  onReachBottom: function() {
    if (!this.data.loading && this.data.hasMore) {
      this.loadOrders()
    }
  },

  // 查看订单详情
  viewOrderDetail: function(e) {
    const dataset = e.currentTarget.dataset
    const orderId = dataset.orderId
    let batchId = dataset.batchId

    // 如果没有 batchId，用订单的数字 ID 代替
    if (!batchId || batchId === 'undefined') {
      batchId = orderId
    }

    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderId=${orderId}&batchId=${batchId}&totalAmount=${dataset.totalAmount || 0}&payStatus=${dataset.payStatus || 'UNPAID'}&createTime=${dataset.createTime || ''}`
    })
  },

  // 重新加载
  retryLoad: function() {
    this.loadOrders()
  },

  onShareAppMessage: function() {
    return {
      title: '校园无人售货柜 - 我的订单',
      path: '/pages/orders/orders'
    }
  }
})