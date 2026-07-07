/**
 * Anomaly Detection View — 异常检测
 * 背景图上传 + 设备/服务端异常记录
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="anomaly-view">' +
        '<div class="ctrl-panel">' +
          '<h3>异常检测背景图 <span id="anomaly-bg-status" style="font-size:12px;color:#94a3b8;">加载中...</span></h3>' +
          '<input type="file" id="anomaly-bg-file" accept=".jpg,.jpeg,.png" style="display:none">' +
          '<button class="btn btn-primary" id="anomaly-bg-upload-btn">上传空柜背景图</button>' +
          '<span style="font-size:12px;color:#64748b;margin-left:8px;">上传空柜照片作为异常检测基线</span>' +
        '</div>' +
        '<div class="ctrl-panel">' +
          '<h3>异常记录 <button class="btn btn-xs" id="anomaly-clear-btn">清空</button></h3>' +
          '<div class="table-wrap" id="anomaly-table"><div class="empty">暂无异常记录</div></div>' +
        '</div>' +
      '</div>';

    var bgFileInput = document.getElementById('anomaly-bg-file');
    document.getElementById('anomaly-bg-upload-btn').addEventListener('click', function () { bgFileInput.click(); });
    bgFileInput.addEventListener('change', function () {
      var f = this.files[0];
      if (!f) return;
      API.uploadBackground(f, '<your-token>', 'D01-F1').then(function () {
        App.showToast('背景图已更新', 'success');
        document.getElementById('anomaly-bg-status').textContent = '已上传';
      }).catch(function (err) { App.showToast('上传失败: ' + err.message, 'error'); });
    });

    API.getBackground('D01-F1').then(function (r) {
      document.getElementById('anomaly-bg-status').textContent = r.exists ? '已上传' : '未上传';
    }).catch(function () {});

    document.getElementById('anomaly-clear-btn').addEventListener('click', function () {
      API.clearAnomalyAlerts().catch(function(){});
      App._anomalyLog = [];
      localStorage.setItem('anomaly_log', '[]');
      renderLog();
    });

    renderLog();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(renderLog, 30000);
    App._intervals.push(refreshTimer);
  }

  function renderLog() {
    API.getAnomalyAlerts().then(function (alerts) {
      if (alerts && alerts.length) {
        for (var i = alerts.length - 1; i >= 0; i--) {
          var a = alerts[i];
          var exists = (App._anomalyLog || []).some(function (x) { return x.id == a.id; });
          if (!exists) {
            App._anomalyLog.unshift({
              id: a.id, time: a.createTime,
              source: '服务端', device: a.deviceId,
              type: a.alertType, level: a.level, detail: a.payload
            });
          }
        }
        if (App._anomalyLog.length > 50) App._anomalyLog.length = 50;
      }
      renderLogUI();
    }).catch(function () { renderLogUI(); });
  }

  function renderLogUI() {
    var el = document.getElementById('anomaly-table');
    if (!el) return;
    var log = App._anomalyLog || [];
    if (!log.length) { el.innerHTML = '<div class="empty">暂无异常记录</div>'; return; }
    el.innerHTML =
      '<table><thead><tr><th>时间</th><th>来源</th><th>设备</th><th>类型</th><th>级别</th><th>详情</th></tr></thead><tbody>' +
      log.map(function (a) {
        var levelBadge = a.level === 'CRIT' ? '<span class="badge badge-danger">CRIT</span>' : '<span class="badge badge-warn">WARN</span>';
        var sourceBadge = a.source === '设备上报' ? '<span class="badge badge-info">设备</span>' : '<span class="badge badge-danger">服务端</span>';
        return '<tr>' +
          '<td>' + a.time + '</td>' +
          '<td>' + sourceBadge + '</td>' +
          '<td>' + a.device + '</td>' +
          '<td>' + a.type + '</td>' +
          '<td>' + levelBadge + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + a.detail + '">' + a.detail + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  App.Router.register('anomaly', render);
})();
