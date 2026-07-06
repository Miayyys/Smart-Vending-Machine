/**
 * Alert Management View — 补货告警
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="alerts-view">' +
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
        '<div class="table-wrap" id="restock-table"></div>' +
      '</div>';

    document.getElementById('restock-status-filter').addEventListener('change', loadRestock);
    document.getElementById('restock-refresh-btn').addEventListener('click', loadRestock);
    document.getElementById('restock-clear-btn').addEventListener('click', clearAllRestock);
    loadRestock();

    refreshTimer = setInterval(loadRestock, 30000);
    App._intervals.push(refreshTimer);
  }

  function clearAllRestock() {
    if (!confirm('确定要清空全部补货告警吗？\n包含已确认和待处理，不可撤销！')) return;
    var btn = document.getElementById('restock-clear-btn');
    btn.disabled = true; btn.textContent = '清空中...';
    API.clearRestockAlerts().then(function (r) {
      App.showToast('已清空 ' + (r.deleted || 0) + ' 条补货告警', 'success');
      loadRestock();
    }).catch(function (err) {
      App.showToast('清空失败: ' + err.message, 'error');
    }).finally(function () { btn.disabled = false; btn.textContent = '清空全部'; });
  }

  function loadRestock() {
    var el = document.getElementById('restock-table');
    if (!el) return;
    var status = document.getElementById('restock-status-filter').value;
    API.getRestockAlerts(status).then(function (alerts) {
      if (!alerts.length) { el.innerHTML = '<div class="empty">暂无补货告警</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>ID</th><th>柜子</th><th>商品</th><th>库存(柜)</th><th>阈值</th><th>状态</th><th>创建时间</th><th>确认时间</th><th>操作</th></tr></thead><tbody>' +
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
            '</td></tr>';
        }).join('') + '</tbody></table>';

      el.querySelectorAll('.ack-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var aid = this.getAttribute('data-aid');
          this.disabled = true; this.textContent = '处理中...';
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

  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('alerts', render);
})();
