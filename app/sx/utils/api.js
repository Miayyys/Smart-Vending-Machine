// utils/api.js
const app = getApp()

/**
 * 统一的请求方法
 * @param {Object} options 请求配置
 * @returns {Promise} Promise对象
 */
const request = function(options) {
  const {
    url,
    method = 'GET',
    data,
    header = {},
    showLoading = true,
    loadingText = '加载中...',
    showToast = true
  } = options

  // 合并请求头
  const headers = {
    'content-type': 'application/json',
    ...header
  }

  // 显示加载提示
  if (showLoading) {
    wx.showLoading({
      title: loadingText,
      mask: true
    })
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.apiBase + url,
      method: method,
      data: data,
      header: headers,
      success: function(res) {
        if (res.statusCode === 200) {
          resolve(res.data)
        } else if (res.statusCode === 401) {
          // 未授权，跳转到登录页
          if (showToast) {
            wx.showToast({
              title: '请重新登录',
              icon: 'none'
            })
          }
          reject(new Error('未授权'))
        } else {
          const errorMsg = res.data && res.data.message ? res.data.message : '请求失败'
          if (showToast) {
            wx.showToast({
              title: errorMsg,
              icon: 'none'
            })
          }
          reject(new Error(errorMsg))
        }
      },
      fail: function(error) {
        console.error('请求失败:', error)
        if (showToast) {
          wx.showToast({
            title: '网络请求失败',
            icon: 'none'
          })
        }
        reject(error)
      },
      complete: function() {
        if (showLoading) {
          wx.hideLoading()
        }
      }
    })
  })
}

/**
 * 移动端网络请求（无鉴权）
 * @param {Object} options 请求配置
 * @returns {Promise} Promise对象
 */
const mobileRequest = function(options) {
  const {
    url,
    method = 'GET',
    data,
    header = {},
    showLoading = true,
    loadingText = '加载中...',
    showToast = true
  } = options

  // 合并请求头
  const headers = {
    'content-type': 'application/json',
    ...header
  }

  // 显示加载提示
  if (showLoading) {
    wx.showLoading({
      title: loadingText,
      mask: true
    })
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: app.globalData.mobileApiBase + url,
      method: method,
      data: data,
      header: headers,
      success: function(res) {
        if (res.statusCode === 200) {
          resolve(res.data)
        } else {
          const errorMsg = res.data && res.data.message ? res.data.message : '请求失败'
          if (showToast) {
            wx.showToast({
              title: errorMsg,
              icon: 'none'
            })
          }
          reject(new Error(errorMsg))
        }
      },
      fail: function(error) {
        console.error('请求失败:', error)
        if (showToast) {
          wx.showToast({
            title: '网络请求失败',
            icon: 'none'
          })
        }
        reject(error)
      },
      complete: function() {
        if (showLoading) {
          wx.hideLoading()
        }
      }
    })
  })
}

/**
 * 上传文件
 * @param {Object} options 上传配置
 * @returns {Promise} Promise对象
 */
const uploadFile = function(options) {
  const {
    filePath,
    fileName,
    url,
    data = {},
    header = {},
    showLoading = true,
    loadingText = '上传中...'
  } = options

  if (showLoading) {
    wx.showLoading({
      title: loadingText,
      mask: true
    })
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: app.globalData.apiBase + url,
      filePath: filePath,
      name: fileName,
      formData: data,
      header: header,
      success: function(res) {
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(res.data)
            resolve(data)
          } catch (e) {
            reject(new Error('解析响应失败'))
          }
        } else {
          reject(new Error('上传失败'))
        }
      },
      fail: function(error) {
        console.error('上传失败:', error)
        reject(error)
      },
      complete: function() {
        if (showLoading) {
          wx.hideLoading()
        }
      }
    })
  })
}

/**
 * 商品相关API
 */
const productsApi = {
  // 获取商品列表
  getProducts: () => request({
    url: '/products',
    method: 'GET'
  }),

  // 获取单个商品
  getProduct: (id) => request({
    url: `/products/${id}`,
    method: 'GET'
  }),

  // 更新商品
  updateProduct: (id, data) => request({
    url: `/products/${id}`,
    method: 'PUT',
    data: data
  })
}

/**
 * 订单相关API
 */
const ordersApi = {
  // 获取订单列表
  getOrders: (params = {}) => {
    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&')
    const url = `/orders${queryString ? '?' + queryString : ''}`
    return request({
      url: url,
      method: 'GET'
    })
  },

  // 获取订单明细
  getOrderItems: (orderId) => request({
    url: `/orders/${orderId}/items`,
    method: 'GET'
  }),

  // 更新订单状态
  updateOrder: (orderId, data) => request({
    url: `/orders/${orderId}/update`,
    method: 'POST',
    data: data
  })
}

/**
 * 移动端API（用户端）
 */
const mobileApi = {
  // 获取商品列表
  getProducts: () => mobileRequest({
    url: '/products',
    method: 'GET'
  }),

  // 发送开门请求
  openDoor: (data) => mobileRequest({
    url: '/open',
    method: 'POST',
    data: data
  }),

  // 查询订单
  getOrder: (batchId) => mobileRequest({
    url: `/order/${batchId}`,
    method: 'GET'
  }),

  // 获取历史订单
  getOrders: (userId) => mobileRequest({
    url: `/orders?userId=${userId}`,
    method: 'GET'
  })
}

/**
 * 库存相关API
 */
const stockApi = {
  // 获取设备库存
  getDeviceStock: (deviceId) => request({
    url: `/devices/${deviceId}/stock`,
    method: 'GET'
  }),

  // 库存校准
  reconcileStock: (data) => request({
    url: '/stock/reconcile',
    method: 'POST',
    data: data
  })
}

/**
 * 告警相关API
 */
const alertsApi = {
  // 获取补货告警
  getRestockAlerts: (status) => request({
    url: `/alerts/restock${status ? `?status=${status}` : ''}`,
    method: 'GET'
  }),

  // 确认补货
  acknowledgeRestock: (id) => request({
    url: `/alerts/restock/${id}/ack`,
    method: 'POST'
  }),

  // 获取异常告警
  getAnomalyAlerts: () => request({
    url: '/alerts/anomaly',
    method: 'GET'
  })
}

/**
 * 拍照相关API
 */
const snapshotsApi = {
  // 搜索拍照记录
  search: (params) => {
    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&')
    const url = `/snapshot/search${queryString ? '?' + queryString : ''}`
    return request({
      url: url,
      method: 'GET'
    })
  },

  // 获取图片文件
  getFile: (id) => request({
    url: `/snapshot/${id}/file`,
    method: 'GET'
  }),

  // 上传图片
  upload: (data, filePath) => uploadFile({
    url: '/snapshot/upload',
    filePath: filePath,
    name: 'file',
    data: data
  }),

  // 删除图片
  delete: (id) => request({
    url: `/snapshot/${id}`,
    method: 'DELETE'
  })
}

/**
 * 网络状态检测
 */
const checkNetwork = function() {
  return new Promise((resolve, reject) => {
    wx.getNetworkType({
      success: res => {
        resolve(res.networkType)
      },
      fail: error => {
        reject(error)
      }
    })
  })
}

/**
 * 显示错误提示
 */
const showError = function(message, duration = 2000) {
  wx.showToast({
    title: message,
    icon: 'none',
    duration: duration
  })
}

/**
 * 显示成功提示
 */
const showSuccess = function(message, duration = 2000) {
  wx.showToast({
    title: message,
    icon: 'success',
    duration: duration
  })
}

module.exports = {
  request,
  mobileRequest,
  uploadFile,
  productsApi,
  ordersApi,
  mobileApi,
  stockApi,
  alertsApi,
  snapshotsApi,
  checkNetwork,
  showError,
  showSuccess
}