/**
 * Alert Management View — 告警管理
 * 两个子标签：补货告警（含 ACK）+ 异常告警
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var activeTab = 'restock';
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="alerts-view">' +
        '<div class="tabs">' +
          '<button class="tab active" data-tab="restock">补货告警</button>' +
          '<button class="tab" data-tab="anomaly">异常告警</button>' +
        '</div>' +
        '<div class="tab-content" id="tab-content"></div>' +
      '</div>';

    container.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeTab = this.getAttribute('data-tab');
        container.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        renderTabContent();
      });
    });

    renderTabContent();

    // MQTT
    var onAnomaly = function () { if (activeTab === 'anomaly') renderTabContent(); };
    App.MQTT.on('retail/+/event/anomaly', onAnomaly);
    App._mqttOff.push(function () { App.MQTT.off('retail/+/event/anomaly', onAnomaly); });

    refreshTimer = setInterval(function () { renderTabContent(); }, 30000);
    App._intervals.push(refreshTimer);
  }

  function renderTabContent() {
    var el = document.getElementById('tab-content');
    if (!el) return;
    if (activeTab === 'restock') renderRestock(el);
    else renderAnomaly(el);
  }

  // ── 补货告警 ──
  function renderRestock(el) {
    el.innerHTML =
      '<div class="toolbar">' +
        '<div class="toolbar-left">' +
          '<label>状态：</label>' +
          '<select id="restock-status-filter">' +
            '<option value="PENDING">待处理</option>' +
            '<option value="ACK">已确认</option>' +
            '<option value="">全部</option>' +
          '</select>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<button class="btn btn-sm" id="restock-refresh-btn">刷新</button> ' +
          '<button class="btn btn-sm btn-danger" id="restock-clear-btn">清空全部</button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap" id="restock-table"></div>';

    document.getElementById('restock-status-filter').addEventListener('change', loadRestock);
    document.getElementById('restock-refresh-btn').addEventListener('click', loadRestock);
    document.getElementById('restock-clear-btn').addEventListener('click', clearAllRestock);
    loadRestock();
  }

  function clearAllRestock() {
    if (!confirm('确定要清空全部补货告警吗？\n包含已确认和待处理，不可撤销！')) return;
    var btn = document.getElementById('restock-clear-btn');
    btn.disabled = true;
    btn.textContent = '清空中...';
    API.clearRestockAlerts().then(function (r) {
      App.showToast('已清空 ' + (r.deleted || 0) + ' 条补货告警', 'success');
      loadRestock();
    }).catch(function (err) {
      App.showToast('清空失败: ' + err.message, 'error');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '清空全部';
    });
  }

  function loadRestock() {
    var el = document.getElementById('restock-table');
    if (!el) return;
    var status = document.getElementById('restock-status-filter').value;
    API.getRestockAlerts(status).then(function (alerts) {
      if (!alerts.length) { el.innerHTML = '<div class="empty">暂无补货告警</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>ID</th><th>柜子</th><th>商品</th><th>当前库存(柜)</th><th>阈值</th><th>状态</th><th>创建时间</th><th>确认时间</th><th>操作</th></tr></thead><tbody>' +
        alerts.map(function (a) {
          var p = App.productMap[a.productId] || { name: '未知#' + a.productId };
          return '<tr>' +
            '<td>' + a.id + '</td>' +
            '<td>' + (App.cabinetName(a.deviceId) || a.deviceId) + '</td>' +
            '<td>' + p.name + '</td>' +
            '<td style="color:' + (a.curQty === 0 ? '#dc2620' : '#ea580c') + ';font-weight:bold;">' + a.curQty + '</td>' +
            '<td>' + a.threshold + '</td>' +
            '<td><span class="badge badge-' + (a.status === 'ACK' ? 'success' : 'warn') + '">' + a.status + '</span></td>' +
            '<td>' + fmtTime(a.createTime) + '</td>' +
            '<td>' + fmtTime(a.ackTime) + '</td>' +
            '<td>' + (a.status === 'PENDING'
              ? '<button class="btn btn-xs btn-primary ack-btn" data-aid="' + a.id + '">确认补货</button>'
              : '<span class="text-muted">已处理</span>') +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      el.querySelectorAll('.ack-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var aid = this.getAttribute('data-aid');
          this.disabled = true;
          this.textContent = '处理中...';
          API.ackRestock(aid).then(function () {
            App.showToast('补货告警 #' + aid + ' 已确认', 'success');
            loadRestock();
          }).catch(function (err) {
            App.showToast('确认失败: ' + err.message, 'error');
            loadRestock();
          });
        });
      });
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  // ── 异常告警 ──
  function renderAnomaly(el) {
    el.innerHTML =
      '<div class="toolbar">' +
        '<div class="toolbar-left">' +
          '<label class="toggle-label">' +
            '<input type="checkbox" id="anomaly-unhandled-only" checked> 仅显示未处理' +
          '</label>' +
        '</div>' +
        '<div class="toolbar-right">' +
          '<button class="btn btn-sm" id="anomaly-refresh-btn">刷新</button> ' +
          '<button class="btn btn-sm btn-danger" id="anomaly-clear-btn">清空全部</button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap" id="anomaly-table"></div>';

    document.getElementById('anomaly-unhandled-only').addEventListener('change', loadAnomaly);
    document.getElementById('anomaly-refresh-btn').addEventListener('click', loadAnomaly);
    document.getElementById('anomaly-clear-btn').addEventListener('click', clearAllAnomaly);
    loadAnomaly();
  }

  function clearAllAnomaly() {
    if (!confirm('确定要清空全部异常告警吗？\n此操作不可撤销！')) return;
    var btn = document.getElementById('anomaly-clear-btn');
    btn.disabled = true;
    btn.textContent = '清空中...';
    API.clearAnomalyAlerts().then(function (r) {
      App.showToast('已清空 ' + (r.deleted || 0) + ' 条异常告警', 'success');
      loadAnomaly();
    }).catch(function (err) {
      App.showToast('清空失败: ' + err.message, 'error');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '清空全部';
    });
  }

  function loadAnomaly() {
    var el = document.getElementById('anomaly-table');
    if (!el) return;
    var cb = document.getElementById('anomaly-unhandled-only');
    var unhandledOnly = cb ? cb.checked : true;
    API.getAnomalyAlerts(unhandledOnly).then(function (alerts) {
      if (!alerts.length) { el.innerHTML = '<div class="empty">暂无异常告警</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>ID</th><th>设备</th><th>类型</th><th>级别</th><th>详情</th><th>时间</th><th>已处理</th></tr></thead><tbody>' +
        alerts.map(function (a) {
          var payloadStr = a.payload || '-';
          if (payloadStr.length > 60) payloadStr = payloadStr.substring(0, 60) + '...';
          return '<tr>' +
            '<td>' + a.id + '</td>' +
            '<td>' + a.deviceId + '</td>' +
            '<td>' + a.alertType + '</td>' +
            '<td><span class="badge badge-' + levelClass(a.level) + '">' + a.level + '</span></td>' +
            '<td title="' + (a.payload || '') + '">' + payloadStr + '</td>' +
            '<td>' + fmtTime(a.createTime) + '</td>' +
            '<td>' + (a.handled ? '<span class="badge badge-success">是</span>' : '<span class="badge badge-danger">否</span>') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function levelClass(lvl) { return lvl === 'CRIT' ? 'danger' : lvl === 'WARN' ? 'warn' : 'info'; }
  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('alerts', render);
})();
