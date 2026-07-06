/**
 * Dashboard View — 仪表盘
 * 4 个统计卡片 + 最近订单 + 最近告警
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="dashboard">' +
        '<div class="stat-cards" id="stat-cards">' +
          '<div class="stat-card"><div class="stat-value skeleton"></div><div class="stat-label">在线设备</div></div>' +
          '<div class="stat-card"><div class="stat-value skeleton"></div><div class="stat-label">商品种类</div></div>' +
          '<div class="stat-card warn"><div class="stat-value skeleton"></div><div class="stat-label">低库存告警</div></div>' +
        '</div>' +
        '<div class="dash-panels">' +
          '<div class="dash-panel">' +
            '<h3>最近订单</h3>' +
            '<div class="table-wrap" id="dash-orders"></div>' +
          '</div>' +
          '<div class="dash-panel">' +
            '<h3>最近告警</h3>' +
            '<div class="table-wrap" id="dash-alerts"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    loadStats();
    loadOrders();
    loadAlerts();

    // MQTT listeners
    var onTake = function () { loadStats(); };
    var onSettle = function () { loadStats(); loadOrders(); };
    var onDetected = function () { loadStats(); loadOrders(); };
    App.MQTT.on('retail/+/event/take', onTake);
    App.MQTT.on('retail/+/event/settle', onSettle);
    App.MQTT.on('retail/+/event/stock_detected', onDetected);
    App._mqttOff.push(function () {
      App.MQTT.off('retail/+/event/take', onTake);
      App.MQTT.off('retail/+/event/settle', onSettle);
      App.MQTT.off('retail/+/event/stock_detected', onDetected);
    });

    // Polling
    refreshTimer = setInterval(function () {
      loadStats();
      loadOrders();
      loadAlerts();
    }, 30000);
    App._intervals.push(refreshTimer);
  }

  function loadStats() {
    var cards = document.querySelectorAll('#stat-cards .stat-value');
    if (!cards.length) return;

    // 拉所有柜库存，统计低库存
    var allDevs = [];
    App.cabinets.forEach(function (cab) {
      App.floors.forEach(function (f) {
        allDevs.push({ cab: cab.id, did: App.buildDeviceId(cab.id, f) });
      });
    });
    Promise.all([
      Promise.all(allDevs.map(function (d) {
        return API.getDeviceStock(d.did).catch(function () { return []; });
      })),
      API.getProducts().catch(function () { return []; }),
    ]).then(function (r) {
      var results = r[0], products = r[1];
      // 单层架构，直接统计
      var lowCount = 0;
      results.forEach(function (stockList) {
        stockList.forEach(function (s) {
          if (s.qty < s.threshold) lowCount++;
        });
      });

      cards[0].textContent = App.cabinets.length;
      cards[1].textContent = products.length;
      cards[2].textContent = lowCount;
      cards[0].classList.remove('skeleton');
      cards[1].classList.remove('skeleton');
      cards[2].classList.remove('skeleton');
    });
  }

  function loadOrders() {
    var el = document.getElementById('dash-orders');
    if (!el) return;
    API.getOrders().then(function (orders) {
      // 后端已返回按 id 倒序，取最新 5 条
      var recent = orders.slice(0, 5);
      if (!recent.length) { el.innerHTML = '<div class="empty">暂无订单</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>ID</th><th>设备</th><th>金额</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
        recent.map(function (o) {
          return '<tr>' +
            '<td>' + o.id + '</td>' +
            '<td>' + (App.cabinetName(o.deviceId) || o.deviceId) + '</td>' +
            '<td>&yen;' + (o.totalAmount || 0).toFixed(2) + '</td>' +
            '<td><span class="badge badge-' + statusClass(o.payStatus) + '">' + (o.payStatus === 'PAID' ? '已支付' : o.payStatus === 'FAILED' ? '失败' : '待支付') + '</span></td>' +
            '<td>' + fmtTime(o.createTime) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function loadAlerts() {
    var el = document.getElementById('dash-alerts');
    if (!el) return;
    Promise.all([
      API.getRestockAlerts('PENDING').catch(function () { return []; }),
      API.getAnomalyAlerts(true).catch(function () { return []; }),
    ]).then(function (r) {
      var restock = r[0].slice(0, 6), anomalies = r[1].slice(0, 3);
      var all = restock.map(function (a) {
        var pn = (App.productMap[a.productId] || {}).name || ('商品#' + a.productId);
        return { type: '补货', device: App.cabinetName(a.deviceId) || a.deviceId, detail: pn + ' 库存: ' + a.curQty + '(阈值' + a.threshold + ')', time: a.createTime, kind: 'restock' };
      }).concat(anomalies.map(function (a) {
        return { type: '异常', device: a.deviceId, detail: a.alertType + ' [' + a.level + ']', time: a.createTime, kind: 'anomaly' };
      }));
      all.sort(function (a, b) { return (b.time || '').localeCompare(a.time || ''); });
      all = all.slice(0, 10);
      if (!all.length) { el.innerHTML = '<div class="empty">暂无告警</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>类型</th><th>设备</th><th>详情</th><th>时间</th></tr></thead><tbody>' +
        all.map(function (a) {
          return '<tr>' +
            '<td><span class="badge badge-' + (a.kind === 'restock' ? 'warn' : 'danger') + '">' + a.type + '</span></td>' +
            '<td>' + a.device + '</td>' +
            '<td>' + a.detail + '</td>' +
            '<td>' + fmtTime(a.time) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function statusClass(s) { return s === 'PAID' ? 'success' : s === 'FAILED' ? 'danger' : 'warn'; }
  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('dashboard', render);
})();
