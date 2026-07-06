// pages/product-detail/product-detail.js
const app = getApp()

Page({
  data: {
    productId: null,
    product: null,
    loading: true,
    error: null,
    availableStock: 0,
    selectedQuantity: 1,
    maxQuantity: 1
  },

  onLoad: function (options) {
    const productId = options.productId
    if (!productId) {
      wx.showToast({
        title: '商品ID不能为空',
        icon: 'none'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)
      return
    }

    this.setData({ productId })
    this.loadProductDetail()
    this.checkAuth()
  },

  // 检查认证状态
  checkAuth: function() {
    const app = getApp()
    if (!app.globalData.userId || !app.globalData.userInfo) {
      wx.showModal({
        title: '请先登录',
        content: '购买商品需要登录后才能继续',
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

  // 加载商品详情
  loadProductDetail: function() {
    const productId = this.data.productId

    this.setData({ loading: true, error: null })

    // 先从商品列表API获取基本信息
    app.request({
      url: `/products/${productId}`
    }).then(product => {
      // 使用商品数据，并设置默认库存
      const productWithStock = {
        ...product,
        stock: 10 // 默认库存为10
      }

      this.setData({
        product: productWithStock,
        loading: false,
        availableStock: 10,
        maxQuantity: 10
      })

    }).catch(error => {
      console.error('加载商品详情失败:', error)
      // 使用模拟数据
      const mockProduct = {
        id: productId,
        name: '商品' + productId,
        price: 5.00,
        sku: 'SKU-' + productId,
        description: '商品描述',
        imageUrl: '',
        deviceId: 'D01',
        stock: 10
      }

      this.setData({
        product: mockProduct,
        loading: false,
        availableStock: 10,
        maxQuantity: 10,
        error: null
      })
    })
  },

  // 增加数量
  increaseQuantity: function() {
    const { selectedQuantity, maxQuantity } = this.data
    if (selectedQuantity < maxQuantity) {
      this.setData({
        selectedQuantity: selectedQuantity + 1
      })
    }
  },

  // 减少数量
  decreaseQuantity: function() {
    const selectedQuantity = this.data.selectedQuantity
    if (selectedQuantity > 1) {
      this.setData({
        selectedQuantity: selectedQuantity - 1
      })
    }
  },

  // 直接输入数量
  onQuantityInput: function(e) {
    let quantity = parseInt(e.detail.value) || 1
    const { maxQuantity } = this.data

    if (quantity < 1) {
      quantity = 1
    } else if (quantity > maxQuantity) {
      quantity = maxQuantity
      wx.showToast({
        title: `最多只能购买${maxQuantity}件`,
        icon: 'none'
      })
    }

    this.setData({
      selectedQuantity: quantity
    })
  },

  // 立即购买
  onBuyNow: function() {
    if (!this.data.product) {
      return
    }

    // 创建订单
    this.createOrder()
  },

  // 加入购物车（预留功能）
  onAddToCart: function() {
    wx.showToast({
      title: '购物车功能开发中',
      icon: 'none'
    })
  },

  // 创建订单
  createOrder: function() {
    const { product, selectedQuantity } = this.data
    const userId = app.globalData.userId

    this.setData({ loading: true })

    app.request({
      url: '/orders',
      method: 'POST',
      data: {
        userId: userId,
        deviceId: product.deviceId || 'D01',
        items: [{
          productId: product.id,
          qty: selectedQuantity,
          price: product.price,
          subtotal: product.price * selectedQuantity
        }],
        totalAmount: product.price * selectedQuantity,
        status: 'UNPAID'
      }
    }).then(order => {
      this.setData({ loading: false })

      // 跳转到订单详情页
      wx.navigateTo({
        url: `/pages/order-detail/order-detail?orderId=${order.id}`
      })
    }).catch(error => {
      console.error('创建订单失败:', error)
      this.setData({ loading: false })
      wx.showToast({
        title: error.message || '创建订单失败',
        icon: 'none'
      })
    })
  },

  // 分享
  onShareAppMessage: function () {
    return {
      title: '校园智能柜 - ' + (this.data.product?.name || '商品'),
      path: `/pages/product-detail/product-detail?productId=${this.data.productId}`,
      imageUrl: this.data.product?.imageUrl
    }
  }
})