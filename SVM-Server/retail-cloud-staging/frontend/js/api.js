/**
 * REST API Client — 封装所有后端 API 调用
 * 挂载到 window.RetailApp.API
 */
(function () {
  'use strict';

  const BASE = '/api';

  async function request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  const API = {
    // ── Health ──
    health() { return request('GET', '/health'); },

    // ── Products ──
    getProducts() { return request('GET', '/products'); },
    getProduct(id) { return request('GET', '/products/' + id); },
    updateProduct(id, data) { return request('PUT', '/products/' + id, data); },

    // ── Stock ──
    getDeviceStock(deviceId) { return request('GET', '/devices/' + deviceId + '/stock'); },
    getLowStock() { return request('GET', '/stock/low'); },
    reconcileStock(deviceId, productId, qty, threshold) {
      const params = new URLSearchParams();
      params.set('deviceId', deviceId);
      params.set('productId', productId);
      if (qty != null) params.set('qty', qty);
      if (threshold != null) params.set('threshold', threshold);
      return request('POST', '/stock/reconcile?' + params.toString());
    },

    // ── Orders ──
    getOrders(deviceId) {
      const qs = deviceId ? '?deviceId=' + encodeURIComponent(deviceId) : '';
      return request('GET', '/orders' + qs);
    },
    createOrder(order) { return request('POST', '/orders', order); },
    getOrderItems(orderId) { return request('GET', '/orders/' + orderId + '/items'); },
    updateOrder(id, data) { return request('POST', '/orders/' + id + '/update', data); },
    clearOrders() { return request('DELETE', '/orders'); },

    // ── Alerts ──
    getRestockAlerts(status) {
      const qs = status ? '?status=' + encodeURIComponent(status) : '';
      return request('GET', '/alerts/restock' + qs);
    },
    ackRestock(id) { return request('POST', '/alerts/restock/' + id + '/ack'); },
    getAnomalyAlerts(unhandledOnly) {
      const qs = unhandledOnly ? '?unhandledOnly=true' : '';
      return request('GET', '/alerts/anomaly' + qs);
    },
    clearRestockAlerts() { return request('DELETE', '/alerts/restock'); },
    clearAnomalyAlerts() { return request('DELETE', '/alerts/anomaly'); },

    // ── Firmware / OTA ──
    getFirmwareList() { return request('GET', '/firmware'); },
    deleteFirmware(id) { return request('DELETE', '/firmware/' + id); },
    getFirmwareDownloadUrl(id) { return BASE + '/firmware/' + id + '/download'; },
    uploadFirmware(file, version, description, type) {
      var fd = new FormData();
      fd.append('file', file);
      fd.append('version', version);
      fd.append('description', description || '');
      fd.append('type', type || 'firmware');
      return fetch(BASE + '/firmware/upload', { method: 'POST', body: fd })
        .then(function (res) {
          if (!res.ok) return res.text().then(function (t) { throw new Error(t); });
          return res.json();
        });
    },

    // ── Snapshot 抓拍图片 ──
    getSnapshots(deviceId, floor, doorAction, limit) {
      var params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      if (floor != null && floor !== '') params.set('floor', floor);
      if (doorAction) params.set('doorAction', doorAction);
      params.set('limit', limit || 100);
      return request('GET', '/snapshot/search?' + params.toString());
    },
    getSnapshotFileUrl(id) { return BASE + '/snapshot/' + id + '/file'; },
    deleteSnapshot(id) { return request('DELETE', '/snapshot/' + id); },
    getSnapshotTokens() { return request('GET', '/snapshot/token'); },
    clearSnapshots() { return request('DELETE', '/snapshot'); },
    getBackground(deviceId) { return request('GET', '/snapshot/background/' + deviceId); },
    uploadBackground(file, token, deviceId) {
      var fd = new FormData();
      fd.append('file', file);
      fd.append('token', token);
      fd.append('deviceId', deviceId);
      return fetch(BASE + '/snapshot/background/upload', { method: 'POST', body: fd })
        .then(function (res) { if (!res.ok) return res.text().then(function (t) { throw new Error(t); }); return res.json(); });
    },

    // ── 推理模型管理 ──
    getModelActive() { return fetch('/api/model/active').then(function(r){return r.json();}); },
    switchModel() { return fetch('/api/model/switch', {method:'POST'}).then(function(r){return r.json();}); },
    toggleInference() { return fetch('/api/model/toggle', {method:'POST'}).then(function(r){return r.json();}); },
  };

  window.RetailApp = window.RetailApp || {};
  window.RetailApp.API = API;
})();
