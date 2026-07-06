// components/loading/loading.js
Component({
  /**
   * 组件的属性列表
   */
  properties: {
    // 是否显示加载中
    loading: {
      type: Boolean,
      value: true
    },
    // 加载文字
    text: {
      type: String,
      value: '加载中...'
    },
    // 是否显示遮罩
    mask: {
      type: Boolean,
      value: true
    },
    // 加载类型
    type: {
      type: String,
      value: 'spinner', // spinner, dots, pulse
      observer: function(newVal, oldVal) {
        this.updateLoadingType(newVal)
      }
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    loadingType: 'spinner',
    animation: null
  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 更新加载类型
    updateLoadingType: function(type) {
      this.setData({
        loadingType: type
      })
    },

    // 动画相关方法
    rotate: function() {
      // 可以添加旋转动画逻辑
    }
  },

  /**
   * 组件生命周期
   */
  lifetimes: {
    attached: function() {
      // 组件挂载
    },

    detached: function() {
      // 组件卸载
    }
  }
})