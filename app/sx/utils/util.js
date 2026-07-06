// utils/util.js

/**
 * 格式化金额
 * @param {number} price 金额
 * @param {number} decimals 小数位数
 * @returns {string} 格式化后的金额
 */
const formatPrice = function(price, decimals = 2) {
  return price.toFixed(decimals)
}

/**
 * 格式化日期
 * @param {string|Date} date 日期
 * @returns {string} 格式化后的日期
 */
const formatDate = function(date) {
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  const second = String(d.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

/**
 * 格式化时间（只显示时分）
 * @param {string|Date} date 日期
 * @returns {string} 格式化后的时间
 */
const formatTime = function(date) {
  const d = new Date(date)
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${hour}:${minute}`
}

/**
 * 格式化日期（显示相对时间）
 * @param {string|Date} date 日期
 * @returns {string} 相对时间描述
 */
const formatRelativeDate = function(date) {
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
    return formatDate(d)
  }
}

/**
 * 生成UUID
 * @returns {string} UUID
 */
const generateUUID = function() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * 获取订单状态标签
 * @param {string} status 订单状态
 * @returns {Object} 状态标签信息
 */
const getOrderStatusTag = function(status) {
  const statusMap = {
    'UNPAID': { text: '待支付', color: 'warning' },
    'PAID': { text: '已支付', color: 'primary' },
    'FAILED': { text: '失败', color: 'error' }
  }
  return statusMap[status] || { text: '未知', color: 'light' }
}

/**
 * 获取设备状态标签
 * @param {string} status 设备状态
 * @returns {Object} 状态标签信息
 */
const getDeviceStatusTag = function(status) {
  const statusMap = {
    'ONLINE': { text: '在线', color: 'primary' },
    'OFFLINE': { text: '离线', color: 'error' },
    'MAINTENANCE': { text: '维护中', color: 'warning' }
  }
  return statusMap[status] || { text: '未知', color: 'light' }
}

/**
 * 获取告警级别标签
 * @param {string} level 告警级别
 * @returns {Object} 级别标签信息
 */
const getAlertLevelTag = function(level) {
  const levelMap = {
    'INFO': { text: '信息', color: 'primary' },
    'WARN': { text: '警告', color: 'warning' },
    'CRIT': { text: '严重', color: 'error' }
  }
  return levelMap[level] || { text: '未知', color: 'light' }
}

/**
 * 深拷贝对象
 * @param {Object} obj 要拷贝的对象
 * @returns {Object} 拷贝后的对象
 */
const deepClone = function(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item))
  }

  if (typeof obj === 'object') {
    const clonedObj = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }
}

/**
 * 防抖函数
 * @param {Function} fn 要执行的函数
 * @param {number} wait 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
const debounce = function(fn, wait = 500) {
  let timeout = null

  return function() {
    const context = this
    const args = arguments

    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      fn.apply(context, args)
    }, wait)
  }
}

/**
 * 节流函数
 * @param {Function} fn 要执行的函数
 * @param {number} wait 等待时间（毫秒）
 * @returns {Function} 节流后的函数
 */
const throttle = function(fn, wait = 500) {
  let lastTime = 0

  return function() {
    const context = this
    const args = arguments
    const now = Date.now()

    if (now - lastTime >= wait) {
      fn.apply(context, args)
      lastTime = now
    }
  }
}

/**
 * 检查是否为空对象
 * @param {Object} obj 要检查的对象
 * @returns {boolean} 是否为空对象
 */
const isEmptyObject = function(obj) {
  return obj && Object.keys(obj).length === 0 && obj.constructor === Object
}

/**
 * 检查是否为空数组
 * @param {Array} arr 要检查的数组
 * @returns {boolean} 是否为空数组
 */
const isEmptyArray = function(arr) {
  return Array.isArray(arr) && arr.length === 0
}

/**
 * 数组去重
 * @param {Array} arr 要去重的数组
 * @returns {Array} 去重后的数组
 */
const uniqueArray = function(arr) {
  return [...new Set(arr)]
}

/**
 * 数组分组
 * @param {Array} arr 要分组的数组
 * @param {string|Function} key 分组键或函数
 * @returns {Object} 分组后的对象
 */
const groupBy = function(arr, key) {
  return arr.reduce((result, item) => {
    const groupKey = typeof key === 'function' ? key(item) : item[key]
    if (!result[groupKey]) {
      result[groupKey] = []
    }
    result[groupKey].push(item)
    return result
  }, {})
}

/**
 * 获取设备名称
 * @param {string} deviceId 设备ID
 * @returns {string} 设备名称
 */
const getDeviceName = function(deviceId) {
  const deviceMap = {
    'D01-F1': '1号柜'
  }
  return deviceMap[deviceId] || deviceId
}

/**
 * 获取商品名称
 * @param {number} productId 商品ID
 * @returns {string} 商品名称
 */
const getProductName = function(productId) {
  const productMap = {
    2: '汽水',
    6: '农夫山泉',
    7: '润田',
    8: '酸奶'
  }
  return productMap[productId] || '未知商品'
}

/**
 * 存储操作
 */
const storage = {
  // 设置存储
  set: function(key, value) {
    try {
      wx.setStorageSync(key, value)
    } catch (e) {
      console.error('存储失败:', e)
    }
  },

  // 获取存储
  get: function(key, defaultValue = null) {
    try {
      return wx.getStorageSync(key) || defaultValue
    } catch (e) {
      console.error('读取存储失败:', e)
      return defaultValue
    }
  },

  // 删除存储
  remove: function(key) {
    try {
      wx.removeStorageSync(key)
    } catch (e) {
      console.error('删除存储失败:', e)
    }
  },

  // 清空存储
  clear: function() {
    try {
      wx.clearStorageSync()
    } catch (e) {
      console.error('清空存储失败:', e)
    }
  }
}

/**
 * 显示加载提示
 * @param {string} text 提示文字
 * @param {boolean} mask 是否遮罩
 */
const showLoading = function(text = '加载中...', mask = true) {
  wx.showLoading({
    title: text,
    mask: mask
  })
}

/**
 * 隐藏加载提示
 */
const hideLoading = function() {
  wx.hideLoading()
}

/**
 * 显示提示
 * @param {string} text 提示文字
 * @param {string} icon 图标
 * @param {number} duration 持续时间
 */
const showToast = function(text, icon = 'none', duration = 2000) {
  wx.showToast({
    title: text,
    icon: icon,
    duration: duration
  })
}

/**
 * 显示模态框
 * @param {Object} options 配置选项
 * @returns {Promise} Promise对象
 */
const showModal = function(options) {
  return new Promise((resolve, reject) => {
    wx.showModal({
      title: options.title || '提示',
      content: options.content || '',
      confirmText: options.confirmText || '确定',
      cancelText: options.cancelText || '取消',
      success: (res) => {
        resolve(res.confirm)
      },
      fail: (error) => {
        reject(error)
      }
    })
  })
}

module.exports = {
  formatPrice,
  formatDate,
  formatTime,
  formatRelativeDate,
  generateUUID,
  getOrderStatusTag,
  getDeviceStatusTag,
  getAlertLevelTag,
  deepClone,
  debounce,
  throttle,
  isEmptyObject,
  isEmptyArray,
  uniqueArray,
  groupBy,
  getDeviceName,
  getProductName,
  storage,
  showLoading,
  hideLoading,
  showToast,
  showModal
}