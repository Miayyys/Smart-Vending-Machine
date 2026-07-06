// components/empty-state/empty-state.js
Component({
  /**
   * 组件的属性列表
   */
  properties: {
    // 图标
    icon: {
      type: String,
      value: '📦'
    },
    // 标题
    title: {
      type: String,
      value: '暂无数据'
    },
    // 描述文字
    description: {
      type: String,
      value: '暂无相关内容'
    },
    // 是否显示操作按钮
    showAction: {
      type: Boolean,
      value: false
    },
    // 按钮文字
    actionText: {
      type: String,
      value: '刷新'
    },
    // 按钮类型
    actionType: {
      type: String,
      value: 'primary' // primary, default, error
    }
  },

  /**
   * 组件的初始数据
   */
  data: {
    // 组件内部数据
  },

  /**
   * 组件的方法列表
   */
  methods: {
    // 点击操作按钮
    onActionTap: function() {
      this.triggerEvent('action')
    },

    // 点击空白区域
    onTap: function() {
      this.triggerEvent('tap')
    }
  }
})