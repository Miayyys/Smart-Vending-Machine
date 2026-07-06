/**
 * 拍照记录 View — 售货柜开门/关门时抓拍图片
 * 顶部筛选 → 列表(缩略图/设备/动作/时间/操作) → 点查看弹大图
 * 数据来自 REST 轮询（30s）；图片走 /api/snapshot/{id}/file（浏览器带 Basic Auth 凭证）
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var refreshTimer = null;
  var lightbox = null;

  function render(container) {
    container.innerHTML =
      '<div class="snap-view">' +
        // 筛选条
        '<div class="ctrl-panel">' +
          '<h3>拍照记录 <button class="btn btn-xs" id="snap-refresh-btn">刷新</button> ' +
          '<span class="text-muted" style="font-size:12px;">每 30 秒自动刷新</span></h3>' +
          '<div class="snap-filter">' +
            '<label>柜子 ' +
              '<select id="snap-cab">' +
                '<option value="">全部</option>' +
                App.cabinets.map(function (c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('') +
              '</select>' +
            '</label>' +
            '<label>动作 ' +
              '<select id="snap-act">' +
                '<option value="">全部</option>' +
                '<option value="OPEN">开门</option>' +
                '<option value="CLOSE">关门</option>' +
              '</select>' +
            '</label>' +
            '<button class="btn btn-primary" id="snap-query-btn">查询</button> ' +
            '<button class="btn btn-danger" id="snap-clear-btn">清空全部</button> ' +
            '<span class="ctrl-status" id="snap-status"></span>' +
          '</div>' +
        '</div>' +
        // 列表
        '<div class="ctrl-panel">' +
          '<div class="table-wrap" id="snap-table"><div class="empty">加载中...</div></div>' +
        '</div>' +
        // 上传提示（设备端模拟用，方便演示）
        '<div class="ctrl-panel">' +
          '<details><summary style="cursor:pointer;color:#64748b;">设备端上传说明（演示用，点击展开）</summary>' +
          '<div style="margin-top:8px;font-size:12px;color:#64748b;font-family:var(--font-mono);">' +
            '设备用 token 免 Basic Auth 上传：<br>' +
            '<code>curl -sk -F "token=&lt;your-token&gt;" -F "deviceId=D01-F1" -F "floor=1" -F "doorAction=OPEN" -F "file=@x.jpg" https://&lt;server&gt;/api/snapshot/upload</code>' +
          '</div></details>' +
        '</div>' +
      '</div>';

    document.getElementById('snap-refresh-btn').addEventListener('click', loadList);
    document.getElementById('snap-query-btn').addEventListener('click', loadList);
    document.getElementById('snap-clear-btn').addEventListener('click', clearAll);
    document.getElementById('snap-cab').addEventListener('change', loadList);
    document.getElementById('snap-act').addEventListener('change', loadList);

    // MQTT 实时通知：后端上传成功后会发 retail/{dev}/event/snapshot → 即时刷新
    var onSnapshot = function (topic, data) {
      if (data && data.deviceId) loadList();
    };
    App.MQTT.on('retail/+/event/snapshot', onSnapshot);
    App._mqttOff.push(function () { App.MQTT.off('retail/+/event/snapshot', onSnapshot); });

    loadList();
    refreshTimer = setInterval(loadList, 30000);
    App._intervals.push(refreshTimer);
  }

  function clearAll() {
    if (!confirm('确定要清空全部抓拍图片吗？\n将删除所有图片文件及记录，不可撤销！')) return;
    var btn = document.getElementById('snap-clear-btn');
    btn.disabled = true;
    btn.textContent = '清空中...';
    API.clearSnapshots().then(function (r) {
      App.showToast('已清空 ' + (r.deleted || 0) + ' 张抓拍图片', 'success');
      loadList();
    }).catch(function (err) {
      App.showToast('清空失败: ' + err.message, 'error');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '清空全部';
    });
  }

  function loadList() {
    var el = document.getElementById('snap-table');
    if (!el) return;
    var cab = document.getElementById('snap-cab').value;
    var act = document.getElementById('snap-act').value;
    var deviceId = cab ? App.buildDeviceId(cab, 1) : null;

    API.getSnapshots(deviceId || null, null, act || null, 100).then(function (list) {
      if (!list || !list.length) { el.innerHTML = '<div class="empty">暂无抓拍记录</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>时间</th><th>设备</th><th>动作</th><th>缩略图</th><th>AI检测</th><th>操作</th></tr></thead><tbody>' +
        list.map(function (s) {
          var url = API.getSnapshotFileUrl(s.id);
          var actLabel = s.doorAction === 'OPEN'
            ? '<span style="color:#16a34a;">开门</span>'
            : s.doorAction === 'SYNC'
            ? '<span style="color:#2563eb;">同步</span>'
            : '<span style="color:#ea580c;">关门</span>';
          // 解析检测结果
          var detectHtml = '';
          if (s.detectionData) {
            try {
              var det = typeof s.detectionData === 'string' ? JSON.parse(s.detectionData) : s.detectionData;
              if (det.success && det.counts) {
                var parts = [];
                Object.keys(det.counts).forEach(function (k) {
                  if (det.counts[k] > 0) parts.push(k + ':' + det.counts[k]);
                });
                detectHtml = '<span style="font-size:11px;color:#16a34a;" title="' + (det.processedMs || 0).toFixed(0) + 'ms">' +
                  (parts.length ? parts.join(' ') : '无') + '</span>';
              } else if (det.error) {
                detectHtml = '<span style="font-size:11px;color:#dc2620;" title="' + det.error + '">失败</span>';
              } else {
                detectHtml = '<span style="font-size:11px;color:#94a3b8;">-</span>';
              }
            } catch (e) {
              detectHtml = '<span style="font-size:11px;color:#94a3b8;">-</span>';
            }
          } else if (s.detectedAt) {
            detectHtml = '<span style="font-size:11px;color:#f59e0b;">处理中</span>';
          } else {
            detectHtml = '<span style="font-size:11px;color:#94a3b8;">待检测</span>';
          }
          return '<tr>' +
            '<td>' + fmtTime(s.createTime) + '</td>' +
            '<td>' + App.deviceName(s.deviceId) + '</td>' +
            '<td>' + actLabel + '</td>' +
            '<td><img class="snap-thumb" data-sid="' + s.id + '" src="' + url + '" alt="snapshot" loading="lazy" style="width:80px;height:60px;object-fit:cover;cursor:pointer;border-radius:4px;"></td>' +
            '<td>' + detectHtml + '</td>' +
            '<td>' +
              '<button class="btn btn-xs view-snap-btn" data-url="' + url + '">查看</button> ' +
              '<button class="btn btn-xs btn-danger del-snap-btn" data-sid="' + s.id + '">删除</button>' +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      // 缩略图点查看
      el.querySelectorAll('.snap-thumb, .view-snap-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var url = this.getAttribute('data-url') || API.getSnapshotFileUrl(this.getAttribute('data-sid'));
          openLightbox(url);
        });
      });
      // 删除
      el.querySelectorAll('.del-snap-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var sid = this.getAttribute('data-sid');
          if (!confirm('确定删除这条抓拍记录？')) return;
          API.deleteSnapshot(sid).then(function () {
            App.showToast('已删除', 'success');
            loadList();
          }).catch(function (err) { App.showToast('删除失败: ' + err.message, 'error'); });
        });
      });
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  // 颜色映射
  // 大图浮层
  function openLightbox(url) {
    closeLightbox();
    lightbox = document.createElement('div');
    lightbox.className = 'snap-lightbox';
    lightbox.innerHTML =
      '<span class="snap-lightbox-close">&times;</span>' +
      '<img src="' + url + '" alt="snapshot-large">';
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target.classList.contains('snap-lightbox-close')) closeLightbox();
    });
    document.body.appendChild(lightbox);
  }

  function closeLightbox() {
    if (lightbox && lightbox.parentNode) { lightbox.parentNode.removeChild(lightbox); }
    lightbox = null;
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('snapshot', render);
})();