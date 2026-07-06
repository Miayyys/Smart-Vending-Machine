/**
 * OTA Firmware View — 固件管理 + 下发升级指令
 * 上传固件 → 选择版本 → MQTT 下发给设备
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="fw-view">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<h3>OTA 升级</h3>' +
          '<div><button class="btn btn-sm" id="model-switch-btn">服务器识别模型: 加载中</button></div>' +
        '</div>' +
        // 上半部分：固件列表 + 上传
        '<div class="fw-top">' +
          '<div class="ctrl-panel" style="flex:2">' +
            '<h3>固件版本列表 <button class="btn btn-xs" id="fw-refresh-btn">刷新</button></h3>' +
            '<div class="table-wrap" id="fw-table"></div>' +
          '</div>' +
          '<div class="ctrl-panel" style="flex:1">' +
            '<h3>上传固件/模型</h3>' +
            '<div class="form-group"><label>类型</label><select id="fw-type"><option value="firmware">固件 (.bin)</option><option value="model">模型 (.espdl)</option></select></div>' +
            '<div class="form-group"><label>版本号</label><input type="text" id="fw-version" placeholder="v1.2.3"></div>' +
            '<div class="form-group"><label>描述</label><input type="text" id="fw-desc" placeholder="修复xxx问题"></div>' +
            '<div class="form-group"><label>文件</label>' +
              '<div class="file-upload"><input type="file" id="fw-file" accept=".bin,.hex,.elf,.espdl"><label for="fw-file" class="file-label">选择文件</label></div>' +
            '</div>' +
            '<div class="form-group" id="fw-file-info" style="display:none">' +
              '<label></label><span class="text-muted" id="fw-file-name"></span>' +
            '</div>' +
            '<div class="ctrl-actions">' +
              '<button class="btn btn-primary" id="fw-upload-btn">上传固件</button>' +
              '<span class="ctrl-status" id="fw-upload-status"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // 下半部分：OTA 下发
        '<div class="ctrl-panel">' +
          '<h3>OTA 下发升级</h3>' +
          '<div class="fw-ota-form">' +
            '<div class="form-group"><label>目标设备</label>' +
              '<select id="ota-cabinet">' +
                App.cabinets.map(function (c) { return '<option value="' + c.id + '">' + c.name + '</option>'; }).join('') +
              '</select>' +
            '</div>' +
            '<div class="form-group"><label>固件版本</label>' +
              '<select id="ota-firmware"><option value="">-- 请先上传固件 --</option></select>' +
            '</div>' +
            '<div class="form-group"><label>指令预览</label>' +
              '<textarea id="ota-preview" rows="3" readonly style="background:#f8fafc;font-family:var(--font-mono);font-size:12px;"></textarea>' +
            '</div>' +
            '<div class="ctrl-actions">' +
              '<button class="btn btn-primary" id="ota-send-btn">发送 OTA 指令</button>' +
              '<span class="ctrl-status" id="ota-status"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // ── 事件绑定 ──
    document.getElementById('fw-refresh-btn').addEventListener('click', loadFirmwareList);
    document.getElementById('fw-upload-btn').addEventListener('click', doUpload);
    document.getElementById('ota-send-btn').addEventListener('click', doOtaSend);

    var fileInput = document.getElementById('fw-file');
    fileInput.addEventListener('change', function () {
      var f = this.files[0];
      if (f) {
        document.getElementById('fw-file-info').style.display = '';
        document.getElementById('fw-file-name').textContent = f.name + ' (' + formatSize(f.size) + ')';
      }
    });

    document.getElementById('ota-firmware').addEventListener('change', updateOtaPreview);
    document.getElementById('ota-cabinet').addEventListener('change', updateOtaPreview);

    // 服务器识别模型切换按钮（演示用）
    var switchBtn = document.getElementById('model-switch-btn');
    function refreshModelLabel() {
      fetch('/api/model/active').then(function(r){return r.json();}).then(function(d){
        switchBtn.textContent = '服务器识别模型: ' + (d.model === 'cross' ? '3类(交叉验证用)' : '4类(主模型)');
      }).catch(function(){});
    }
    switchBtn.addEventListener('click', function(){
      switchBtn.disabled = true;
      fetch('/api/model/switch', {method:'POST'}).then(function(r){return r.json();}).then(function(d){
        App.showToast('已切换到: ' + (d.model === 'cross' ? '3类交叉模型' : '4类主模型'), 'success');
        refreshModelLabel();
      }).catch(function(err){
        App.showToast('切换失败: ' + err.message, 'error');
      }).finally(function(){ switchBtn.disabled = false; });
    });
    refreshModelLabel();

    loadFirmwareList();
    refreshTimer = setInterval(loadFirmwareList, 60000);
    App._intervals.push(refreshTimer);

    // OTA 进度监听
    var onOtaProgress = function (topic, data) {
      if (!data) return;
      var statusEl = document.getElementById('ota-status');
      if (!statusEl) return;
      var typeLabel = data.type === 'model' ? '模型' : '固件';
      if (data.status === 'success') {
        statusEl.innerHTML = '<span class="text-success">' + typeLabel + '升级完成!</span>';
        setTimeout(function () { statusEl.innerHTML = ''; }, 5000);
      } else if (data.status === 'failed') {
        statusEl.innerHTML = '<span class="text-danger">' + typeLabel + '升级失败: ' + (data.message || '') + '</span>';
      } else {
        statusEl.innerHTML = '<span class="text-muted">' + typeLabel + '升级中... ' + data.progress + '% (' + data.status + ')</span>';
      }
    };
    App.MQTT.on('retail/+/event/ota_progress', onOtaProgress);
    App._mqttOff.push(function () { App.MQTT.off('retail/+/event/ota_progress', onOtaProgress); });
  }

  // ── 固件列表 ──
  function loadFirmwareList() {
    var el = document.getElementById('fw-table');
    var sel = document.getElementById('ota-firmware');
    if (!el) return;

    API.getFirmwareList().then(function (list) {
      // 更新下拉
      if (sel) {
        sel.innerHTML = '<option value="">-- 选择固件版本 --</option>' +
          list.map(function (f) { return '<option value="' + f.id + '">[' + (f.type === 'model' ? '模型' : '固件') + '] ' + f.version + ' (' + formatSize(f.fileSize) + ')</option>'; }).join('');
        // 给 option 加 data 属性用于预览
        list.forEach(function (f, i) {
          if (sel.options[i + 1]) {
            sel.options[i + 1].dataset.md5 = f.md5 || '';
            sel.options[i + 1].dataset.url = API.getFirmwareDownloadUrl(f.id);
            sel.options[i + 1].dataset.size = f.fileSize || 0;
            sel.options[i + 1].dataset.version = f.version;
            sel.options[i + 1].dataset.type = f.type || 'firmware';
          }
        });
      }

      if (!list.length) { el.innerHTML = '<div class="empty">暂无固件</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>ID</th><th>类型</th><th>版本</th><th>文件名</th><th>大小</th><th>MD5</th><th>描述</th><th>上传时间</th><th>操作</th></tr></thead><tbody>' +
        list.map(function (f) {
          return '<tr>' +
            '<td>' + f.id + '</td>' +
            '<td><span class="badge badge-' + (f.type === 'model' ? 'info' : 'warn') + '">' + (f.type === 'model' ? '模型' : '固件') + '</span></td>' +
            '<td><strong>' + f.version + '</strong></td>' +
            '<td>' + (f.fileName || '-') + '</td>' +
            '<td>' + formatSize(f.fileSize) + '</td>' +
            '<td><code>' + (f.md5 || '').substring(0, 8) + '</code></td>' +
            '<td>' + (f.description || '-') + '</td>' +
            '<td>' + fmtTime(f.createTime) + '</td>' +
            '<td><button class="btn btn-xs btn-danger del-fw-btn" data-fid="' + f.id + '">删除</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      el.querySelectorAll('.del-fw-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var fid = this.getAttribute('data-fid');
          if (!confirm('确定删除该固件？')) return;
          API.deleteFirmware(fid).then(function () {
            App.showToast('固件已删除', 'success');
            loadFirmwareList();
          }).catch(function (err) {
            App.showToast('删除失败: ' + err.message, 'error');
          });
        });
      });
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  // ── 上传 ──
  function doUpload() {
    var fileInput = document.getElementById('fw-file');
    var version = document.getElementById('fw-version').value.trim();
    var desc = document.getElementById('fw-desc').value.trim();
    var statusEl = document.getElementById('fw-upload-status');
    var btn = document.getElementById('fw-upload-btn');

    if (!version) { statusEl.innerHTML = '<span class="text-danger">请输入版本号</span>'; return; }
    if (!fileInput.files.length) { statusEl.innerHTML = '<span class="text-danger">请选择文件</span>'; return; }

    var type = document.getElementById('fw-type').value;
    var file = fileInput.files[0];
    btn.disabled = true;
    statusEl.innerHTML = '<span class="text-muted">上传中...</span>';

    API.uploadFirmware(file, version, desc, type).then(function () {
      statusEl.innerHTML = '<span class="text-success">上传成功!</span>';
      btn.disabled = false;
      document.getElementById('fw-version').value = '';
      document.getElementById('fw-desc').value = '';
      fileInput.value = '';
      document.getElementById('fw-file-info').style.display = 'none';
      loadFirmwareList();
      setTimeout(function () { statusEl.innerHTML = ''; }, 3000);
    }).catch(function (err) {
      statusEl.innerHTML = '<span class="text-danger">失败: ' + err.message + '</span>';
      btn.disabled = false;
    });
  }

  // ── OTA 预览 ──
  function updateOtaPreview() {
    var sel = document.getElementById('ota-firmware');
    var cab = document.getElementById('ota-cabinet').value;
    var preview = document.getElementById('ota-preview');
    if (!sel.selectedIndex) { preview.value = ''; return; }
    var opt = sel.options[sel.selectedIndex];
    var payload = {
      action: 'OTA_UPDATE',
      type: opt.dataset.type || 'firmware',
      version: opt.dataset.version || '',
      url: opt.dataset.url || '',
      md5: opt.dataset.md5 || '',
      size: parseInt(opt.dataset.size, 10) || 0,
    };
    var topics = [ 'retail/' + App.buildDeviceId(cab, 1) + '/cmd/ota' ];
    preview.value = topics.join('\n') + '\n' + JSON.stringify(payload, null, 2);
    preview._topics = topics;
    preview._payload = JSON.stringify(payload);
  }

  // ── 发送 OTA（向该柜下发） ──
  function doOtaSend() {
    var preview = document.getElementById('ota-preview');
    var statusEl = document.getElementById('ota-status');
    var btn = document.getElementById('ota-send-btn');

    if (!preview._topics || !preview._topics.length || !preview._payload) {
      statusEl.innerHTML = '<span class="text-danger">请选择固件版本</span>';
      return;
    }

    var payload;
    try { payload = JSON.parse(preview._payload); } catch (e) {
      statusEl.innerHTML = '<span class="text-danger">JSON 错误</span>'; return;
    }

    btn.disabled = true;
    statusEl.innerHTML = '<span class="text-muted">发送中...</span>';

    Promise.all(preview._topics.map(function (t) {
      return App.MQTT.publish(t, payload, 1).catch(function () { return null; });
    })).then(function (results) {
      var ok = results.filter(function (r) { return r !== null; }).length;
      statusEl.innerHTML = '<span class="text-success">下发成功</span>';
      btn.disabled = false;
      setTimeout(function () { statusEl.innerHTML = ''; }, 4000);
    });
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('firmware', render);
})();
