// pages/products/products.js
const app = getApp()

Page({
  data: {
    products: [],
    loading: true,
    error: null
  },

  onLoad: function (options) {
    // 检查登录状态
    this.checkAuth()
    // 加载商品列表
    this.loadProducts()
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

  onShow: function () {
    wx.onNetworkStatusChange(this.onNetworkStatusChange)
    const lastError = wx.getStorageSync('last_error')
    if (lastError && Date.now() - new Date(lastError.time).getTime() > 30000) {
      this.loadProducts()
    }
  },

  onNetworkStatusChange: function(res) {
    console.log('网络状态变化:', res)
    if (res.networkType && res.networkType !== 'none') {
      setTimeout(() => { this.loadProducts() }, 1000)
    }
  },

  onPullDownRefresh: function () {
    this.loadProducts().then(() => { wx.stopPullDownRefresh() })
  },

  loadProducts: function() {
    console.log('=== 开始加载商品列表 ===')
    this.setData({ loading: true, error: null })
    console.log('网络类型:', getApp().globalData.networkType)

    // 同时请求商品列表和库存
    return Promise.all([
      app.mobileRequest({ url: '/api/mobile/products', timeout: 10000 }),
      app.mobileRequest({ url: '/api/devices/D01-F1/stock', showLoading: false })
    ]).then(([productsData, stockData]) => {
      console.log('商品API数据:', productsData)
      console.log('库存API数据:', stockData)

      // 构建 productId → qty 的映射
      const stockMap = {}
      if (Array.isArray(stockData)) {
        stockData.forEach(item => {
          stockMap[item.productId] = item.qty
        })
      }

      // 商品图片映射
      const productImages = ['/1.jpg', '/2.png', '/3.jpg', '/4.png']

      // 合并库存和图片到商品数据
      const productsWithStock = productsData.map((product, index) => ({
        ...product,
        stock: stockMap[product.id] !== undefined ? stockMap[product.id] : 0,
        imageUrl: productImages[index] || '/images/product-placeholder.png'
      }))

      this.setData({
        products: productsWithStock,
        loading: false
      })
      console.log('设置数据完成，商品数量:', productsWithStock.length)
    }).catch(error => {
      console.error('API请求失败，错误详情:', error)
      this.setData({
        loading: false,
        error: '无法连接到服务器，请检查网络'
      })
    })
  },

  // 跳转到开门页面
  goToOpenDoor: function(e) {
    if (e && e.currentTarget && e.currentTarget.dataset) {
      // 从商品项点击进来，记录选中的商品
      const productId = e.currentTarget.dataset.id
      const productName = e.currentTarget.dataset.name
      const productPrice = e.currentTarget.dataset.price

      wx.showModal({
        title: '确认开门',
        content: `是否确认打开柜门拿取${productName}？`,
        confirmText: '确认开门',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.openDoor(productId, productName, productPrice)
          }
        }
      })
    } else {
      // 从顶部"开门购买"按钮点击，开门并跳转到订单查询
      wx.showModal({
        title: '确认开门',
        content: '是否确认打开柜门拿取商品？',
        confirmText: '确认开门',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.openDoor()
          }
        }
      })
    }
  },

  // 开门功能
  openDoor: function(productId, productName, productPrice) {
    const app = getApp()
    wx.showLoading({
      title: '正在开门...',
      mask: true
    })

    const userId = app.globalData.userId || app.generateUUID()
    const deviceId = 'D01-F1' // 固定设备ID

    // 调用开门API
    app.mobileRequest({
      url: '/api/mobile/open',
      method: 'POST',
      data: {
        userId: userId,
        deviceId: deviceId
      },
      showLoading: false
    }).then(result => {
      wx.hideLoading()
      console.log('开门成功:', result)

      // 保存 batchId
      wx.setStorageSync('currentBatchId', result.batchId)

      if (productId && productName && productPrice) {
        // 如果指定了商品，跳转到订单详情页（预加载）
        wx.navigateTo({
          url: `/pages/order-detail/order-detail?batchId=${result.batchId}&productId=${productId}&productName=${productName}&productPrice=${productPrice}`
        })
      } else {
        // 否则直接开始轮询订单
        wx.showToast({
          title: '门已开启，请拿取商品',
          icon: 'none',
          duration: 3000
        })

        // 延迟几秒后开始轮询（给用户拿商品时间）
        setTimeout(() => {
          this.pollOrder(result.batchId)
        }, 3000)
      }
    }).catch(error => {
      wx.hideLoading()
      console.error('开门失败:', error)
      wx.showToast({
        title: '开门失败，请重试',
        icon: 'none'
      })
    })
  },

  // 轮询订单状态
  pollOrder: function(batchId) {
    const app = getApp()
    const pollInterval = setInterval(() => {
      app.mobileRequest({
        url: `/api/mobile/order/${batchId}`,
        showLoading: false
      }).then(order => {
        if (order.found) {
          clearInterval(pollInterval)
          this.showOrderDetail(order)
        }
      }).catch(error => {
        // 30秒超时
        const elapsedTime = Date.now() - this.pollStartTime
        if (elapsedTime > 30000) {
          clearInterval(pollInterval)
          wx.showToast({
            title: '订单生成超时，请重试',
            icon: 'none'
          })
        }
      })
    }, 2000)
  },

  // 显示订单详情
  showOrderDetail: function(order) {
    if (order.found) {
      const items = order.items.map(item =>
        `${item.productName} x${item.qty} = ¥${item.subtotal}`
      ).join('\n')

      wx.showModal({
        title: '订单生成',
        content: `订单号：${order.batchId}\n商品明细：\n${items}\n总金额：¥${order.totalAmount}\n支付状态：${order.payStatus}`,
        showCancel: true,
        confirmText: '查看历史订单',
        cancelText: '确定',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({
              url: '/pages/orders/orders'
            })
          }
        }
      })
    }
  },

  onRefresh: function() {
    this.loadProducts()
  },

  // 选择商品
  selectProduct: function(e) {
    const id = e.currentTarget.dataset.id
    const products = this.data.products.map(p => ({
      ...p,
      selected: p.id === id ? !p.selected : p.selected
    }))

    this.setData({ products })
  },

  // 跳转到商品详情
  goToProductDetail: function(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const price = e.currentTarget.dataset.price

    // 商品详情页改为展示商品信息，无购买功能
    wx.showModal({
      title: '商品信息',
      content: `商品：${name}\n价格：¥${price}`,
      showCancel: true,
      confirmText: '开门购买',
      cancelText: '返回',
      success: (res) => {
        if (res.confirm) {
          // 调用开门功能
          this.goToOpenDoor({
            currentTarget: {
              dataset: {
                id: id,
                name: name,
                price: price
              }
            }
          })
        }
      }
    })
  },

  onShareAppMessage: function() {
    return {
      title: '校园无人售货柜',
      path: '/pages/index/index'
    }
  }
})