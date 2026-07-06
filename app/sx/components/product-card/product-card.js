// components/product-card/product-card.js
Component({
  /**
   * 组件的属性列表
   */
  properties: {
    // 商品数据
    product: {
      type: Object,
      value: null
    },
    // 是否显示价格
    showPrice: {
      type: Boolean,
      value: true
    },
    // 是否显示操作按钮
    showAction: {
      type: Boolean,
      value: true
    },
    // 是否显示库存状态
    showStockStatus: {
      type: Boolean,
      value: false
    },
    // 库存数量
    stock: {
      type: Number,
      value: 0
    },
    // 库存阈值
    threshold: {
      type: Number,
      value: 1
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    stockStatus: 'normal', // normal, low, outOfStock
    stockStatusText: '',
    stockStatusColor: ''
  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 点击商品卡片
    onProductTap: function() {
      this.triggerEvent('producttap', {
        product: this.properties.product
      })
    },

    // 点击购买按钮
    onBuyTap: function() {
      this.triggerEvent('buytap', {
        product: this.properties.product
      })
    },

    // 查看商品详情
    onViewDetail: function() {
      this.triggerEvent('viewdetail', {
        product: this.properties.product
      })
    },

    // 获取库存状态
    getStockStatus: function() {
      const stock = this.properties.stock
      const threshold = this.properties.threshold

      if (stock === 0) {
        return {
          status: 'outOfStock',
          text: '缺货',
          color: 'text-error'
        }
      } else if (stock <= threshold) {
        return {
          status: 'low',
          text: '库存不足',
          color: 'text-warning'
        }
      } else {
        return {
          status: 'normal',
          text: '库存充足',
          color: 'text-primary'
        }
      }
    },

    // 图片加载错误
    onImageError: function(e) {
      console.error('图片加载失败:', e)
      // 可以在这里设置默认图片
    }
  },

  /**
   * 组件生命周期
   */
  lifetimes: {
    attached: function() {
      // 组件挂载时计算库存状态
      if (this.properties.showStockStatus) {
        const stockStatus = this.getStockStatus()
        this.setData(stockStatus)
      }
    },

    detached: function() {
      // 组件卸载
    }
  },

  /**
   * 组件数据字段观测
   */
  observers: {
    'stock, threshold': function(stock, threshold) {
      if (this.properties.showStockStatus) {
        const stockStatus = this.getStockStatus()
        this.setData(stockStatus)
      }
    }
  }
})