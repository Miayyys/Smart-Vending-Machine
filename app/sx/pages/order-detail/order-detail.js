// pages/order-detail/order-detail.js
const app = getApp()

Page({
  data: {
    orderId: '',
    batchId: '',
    order: null,
    statusTag: { text: '', color: '' },
    loading: true,
    error: null,
    // 从订单列表传来的基本信息（降级用）
    listTotalAmount: 0,
    listPayStatus: 'UNPAID',
    listCreateTime: ''
  },

  onLoad: function (options) {
    const orderId = options.orderId
    const batchId = options.batchId

    if (!batchId || batchId === 'undefined') {
      wx.showToast({
        title: '订单信息不完整',
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
      return
    }

    this.setData({
      orderId: orderId,
      batchId: batchId,
      listTotalAmount: options.totalAmount || 0,
      listPayStatus: options.payStatus || 'UNPAID',
      listCreateTime: options.createTime || ''
    })

    this.loadOrderDetail()
  },

  onShow: function () {
    // 页面显示时刷新数据
  },

  // 加载订单详情
  loadOrderDetail: function() {
    const batchId = this.data.batchId
    const orderId = this.data.orderId
    console.log('加载订单详情，batchId:', batchId, 'orderId:', orderId)

    this.setData({ loading: true, error: null })

    // 使用 mobileRequest 调用订单详情 API
    app.mobileRequest({
      url: `/api/mobile/order/${batchId}`,
      method: 'GET',
      showLoading: false
    }).then(res => {
      console.log('订单详情API成功:', res)

      // 检查订单数据是否有效
      if (res && (res.found || res.totalAmount)) {
        // 有效数据，渲染
        this.renderOrder(res)
      } else if (orderId && !isNaN(orderId)) {
        // 移动端没找到，且 orderId 是数字，尝试管理端 API
        console.log('移动端API未找到，尝试管理端API')
        return app.request({
          url: `/orders/${orderId}/items`,
          method: 'GET',
          showLoading: false
        }).then(items => {
          console.log('管理端API成功:', items)
          const orderData = {
            found: true,
            batchId: batchId,
            orderId: orderId,
            items: Array.isArray(items) ? items : [],
            totalAmount: this.data.listTotalAmount,
            payStatus: this.data.listPayStatus,
            createTime: this.data.listCreateTime,
            deviceId: '',
            userId: ''
          }
          // 再取商品列表映射名称
          return app.mobileRequest({
            url: '/api/mobile/products',
            showLoading: false
          }).then(products => {
            const productMap = {}
            if (Array.isArray(products)) {
              products.forEach(p => { productMap[p.id] = p.name })
            }
            orderData.items = orderData.items.map(item => ({
              ...item,
              productName: productMap[item.productId] || '商品' + item.productId
            }))
            this.renderOrder(orderData)
          }).catch(() => {
            this.renderOrder(orderData)
          })
        })
      } else {
        this.setData({
          loading: false,
          error: '订单数据无效'
        })
      }
    }).catch(error => {
      console.error('订单详情API失败:', error)
      this.setData({
        loading: false,
        error: '加载订单详情失败'
      })
    })
  },

  // 渲染订单数据
  renderOrder: function(res) {
    // 确保 items 是数组
    if (!res.items || !Array.isArray(res.items)) {
      res.items = []
    }

    // 预计算状态标签
    const statusTag = this.getOrderStatusTag(res.payStatus)
    // 预计算每个 item 的小计
    const items = res.items.map(item => ({
      ...item,
      subtotal: (item.price || 0) * (item.quantity || item.qty || 1)
    }))

    this.setData({
      order: { ...res, items, totalAmount: Number(res.totalAmount || 0).toFixed(2) },
      statusTag: statusTag,
      loading: false
    })
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.loadOrderDetail()
    wx.stopPullDownRefresh()
  },

  // 重新加载
  retryLoad: function() {
    this.loadOrderDetail()
  },

  // 返回订单列表
  goBack: function() {
    wx.navigateBack()
  },

  // 支付
  payOrder: function() {
    const orderId = this.data.order.orderId || this.data.orderId
    if (!orderId) {
      wx.showToast({
        title: '订单号无效',
        icon: 'none'
      })
      return
    }

    const userId = app.globalData.userId
    if (!userId) {
      wx.showToast({
        title: '用户未登录',
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '支付中...', mask: true })

    app.mobileRequest({
      url: '/api/mobile/pay',
      method: 'POST',
      data: {
        orderId: orderId,
        userId: userId
      },
      showLoading: false
    }).then(res => {
      wx.hideLoading()
      wx.showToast({
        title: '支付成功',
        icon: 'success'
      })
      // 标记订单列表需要刷新
      wx.setStorageSync('refreshOrders', true)
      // 刷新订单详情
      this.loadOrderDetail()
    }).catch(error => {
      wx.hideLoading()
      console.error('支付失败:', error)
      wx.showToast({
        title: '支付失败，请重试',
        icon: 'none'
      })
    })
  },

  // 获取订单状态标签
  getOrderStatusTag: function(status) {
    const statusMap = {
      'UNPAID': { text: '待支付', color: 'warning' },
      'PAID': { text: '已支付', color: 'primary' },
      'FAILED': { text: '失败', color: 'error' }
    }
    return statusMap[status] || { text: '未知', color: 'light' }
  },

  // 分享
  onShareAppMessage: function () {
    return {
      title: '订单详情',
      path: `/pages/order-detail/order-detail?orderId=${this.data.orderId}&batchId=${this.data.batchId}`
    }
  }
})