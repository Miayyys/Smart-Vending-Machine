// components/order-card/order-card.js
Component({
  /**
   * 组件的属性列表
   */
  properties: {
    // 订单数据
    order: {
      type: Object,
      value: null
    },
    // 是否展开显示详情
    expanded: {
      type: Boolean,
      value: false
    },
    // 是否显示操作按钮
    showActions: {
      type: Boolean,
      value: true
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    statusTag: null,
    displayTime: ''
  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 获取订单状态标签
    getOrderStatusTag: function() {
      const status = this.properties.order.payStatus
      const statusMap = {
        'UNPAID': { text: '待支付', color: 'warning' },
        'PAID': { text: '已支付', color: 'primary' },
        'FAILED': { text: '失败', color: 'error' }
      }
      return statusMap[status] || { text: '未知', color: 'light' }
    },

    // 格式化显示时间
    formatDisplayTime: function() {
      const createTime = this.properties.order.createTime
      return this.formatRelativeDate(createTime)
    },

    // 格式化相对日期
    formatRelativeDate: function(date) {
      const d = new Date(date)
      const now = new Date()
      const diff = now - d
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor(diff / (1000 * 60))

      if (minutes < 1) {
        return '刚刚'
      } else if (minutes < 60) {
        return `${minutes}分钟前`
      } else if (hours < 24) {
        return `${hours}小时前`
      } else if (days === 0) {
        return '今天'
      } else if (days === 1) {
        return '昨天'
      } else if (days < 7) {
        return `${days}天前`
      } else {
        return this.formatDate(d)
      }
    },

    // 格式化日期
    formatDate: function(date) {
      const d = new Date(date)
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const hour = String(d.getHours()).padStart(2, '0')
      const minute = String(d.getMinutes()).padStart(2, '0')
      return `${month}-${day} ${hour}:${minute}`
    },

    // 点击订单卡片
    onOrderTap: function() {
      this.setData({
        expanded: !this.data.expanded
      })
    },

    // 查看订单详情
    onViewDetail: function() {
      this.triggerEvent('viewdetail', {
        order: this.properties.order
      })
    },

    // 支付订单
    onPay: function() {
      this.triggerEvent('pay', {
        order: this.properties.order
      })
    },

    // 删除订单
    onDelete: function() {
      this.triggerEvent('delete', {
        order: this.properties.order
      })
    },

    // 编辑订单
    onEdit: function() {
      this.triggerEvent('edit', {
        order: this.properties.order
      })
    }
  },

  /**
   * 组件生命周期
   */
  lifetimes: {
    attached: function() {
      // 组件挂载时计算状态和显示时间
      const statusTag = this.getOrderStatusTag()
      const displayTime = this.formatDisplayTime()
      this.setData({
        statusTag: statusTag,
        displayTime: displayTime
      })
    },

    detached: function() {
      // 组件卸载
    }
  },

  /**
   * 组件数据字段观测
   */
  observers: {
    'order.createTime': function(createTime) {
      if (createTime) {
        this.setData({
          displayTime: this.formatDisplayTime()
        })
      }
    }
  }
})