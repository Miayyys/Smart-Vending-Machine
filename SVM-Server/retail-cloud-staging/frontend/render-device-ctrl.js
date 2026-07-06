/**
 * Device Control View — 设备控制（下发指令）
 * 云端 → 设备 downlink: retail/<device>/cmd/<action>
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var history = []; // { topic, payload, time, ok }

  // 常用预设指令
  var PRESETS = [
    { label: '远程开门', topic: 'retail/{dev}/cmd/unlock', payload: '{"action":"UNLOCK","duration":30}' },
    { label: '远程锁门', topic: 'retail/{dev}/cmd/lock',   payload: '{"action":"LOCK"}' },
    { label: '重启设备', topic: 'retail/{dev}/cmd/reboot',  payload: '{"action":"REBOOT"}' },
  ];

  function render(container) {
    container.innerHTML =
      '<div class="ctrl-view">' +
        '<div class="ctrl-top">' +
          // 左侧：指令编辑
          '<div class="ctrl-panel">' +
            '<h3>下发指令</h3>' +
            '<div class="form-group">' +
              '<label>目标设备</label>' +
              '<div class="device-picker">' +
                '<select id="ctrl-cabinet">' +
                  App.cabinets.map(function (c) {
                    return '<option value="' + c.id + '">' + c.name + '</option>';
                  }).join('') +
                '</select>' +
              '</div>' +
              '<div class="form-group">' +
              '<label>主题 Topic</label>' +
              '<input type="text" id="ctrl-topic" value="retail/D01-F1/cmd/restock" placeholder="retail/D01-F1/cmd/restock">' +
            '</div>' +
            '<div class="form-group">' +
              '<label>消息内容</label>' +
              '<textarea id="ctrl-payload" rows="4" placeholder=\'{"action":"RESTOCK_DONE"}\'></textarea>' +
            '</div>' +
            '<div class="ctrl-actions">' +
              '<button class="btn btn-primary" id="ctrl-send">发送指令</button>' +
              '<span class="ctrl-status" id="ctrl-status"></span>' +
            '</div>' +
          '</div>' +
          // 右侧：预设快捷指令
          '<div class="ctrl-panel">' +
            '<h3>快捷指令</h3>' +
            '<div class="preset-list" id="preset-list">' +
              PRESETS.map(function (p, i) {
                return '<button class="preset-btn" data-idx="' + i + '">' +
                  '<strong>' + p.label + '</strong>' +
                  '<small>' + p.topic.replace('{dev}', 'D01') + '</small>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
        // 下发历史
        '<div class="ctrl-panel ctrl-history">' +
          '<h3>下发历史 <button class="btn btn-xs" id="ctrl-clear-history">清空</button></h3>' +
          '<div class="table-wrap" id="ctrl-history-table">' +
            '<div class="empty">暂无下发记录</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var cabSelect = document.getElementById('ctrl-cabinet');
    var topicInput = document.getElementById('ctrl-topic');
    var payloadArea = document.getElementById('ctrl-payload');

    function getDeviceId() {
      return App.buildDeviceId(cabSelect.value, 1);
    }

    function updateTopic() {
      topicInput.value = topicInput.value.replace(/retail\/[^/]+\/cmd/, 'retail/' + getDeviceId() + '/cmd');
    }

    cabSelect.addEventListener('change', updateTopic);

    // 快捷指令点击
    document.getElementById('preset-list').addEventListener('click', function (e) {
      var btn = e.target.closest('.preset-btn');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-idx'), 10);
      var preset = PRESETS[idx];
      if (!preset) return;
      var dev = getDeviceId();
      topicInput.value = preset.topic.replace('{dev}', dev);
      payloadArea.value = preset.payload;
    });

    // 发送按钮
    document.getElementById('ctrl-send').addEventListener('click', function () {
      var topic = topicInput.value.trim();
      var payloadStr = payloadArea.value.trim();
      var statusEl = document.getElementById('ctrl-status');
      var sendBtn = document.getElementById('ctrl-send');

      if (!topic) { statusEl.innerHTML = '<span class="text-danger">请输入 Topic</span>'; return; }
      if (!payloadStr) { statusEl.innerHTML = '<span class="text-danger">请输入消息内容</span>'; return; }

      // 校验 JSON
      var payload;
      try { payload = JSON.parse(payloadStr); } catch (e) {
        statusEl.innerHTML = '<span class="text-danger">JSON 格式错误: ' + e.message + '</span>';
        return;
      }

      sendBtn.disabled = true;
      statusEl.innerHTML = '<span class="text-muted">发送中...</span>';

      App.MQTT.publish(topic, payload, 1).then(function () {
        statusEl.innerHTML = '<span class="text-success">发送成功!</span>';
        sendBtn.disabled = false;
        addHistory(topic, payloadStr, true);
        setTimeout(function () { statusEl.innerHTML = ''; }, 3000);
      }).catch(function (err) {
        statusEl.innerHTML = '<span class="text-danger">发送失败: ' + err.message + '</span>';
        sendBtn.disabled = false;
        addHistory(topic, payloadStr, false);
      });
    });

    // 清空历史
    document.getElementById('ctrl-clear-history').addEventListener('click', function () {
      history = [];
      renderHistory();
    });

    renderHistory();
  }

  function addHistory(topic, payload, ok) {
    history.unshift({ topic: topic, payload: payload, time: new Date().toLocaleString(), ok: ok });
    if (history.length > 50) history.length = 50;
    renderHistory();
  }

  function renderHistory() {
    var el = document.getElementById('ctrl-history-table');
    if (!el) return;
    if (!history.length) { el.innerHTML = '<div class="empty">暂无下发记录</div>'; return; }
    el.innerHTML =
      '<table><thead><tr><th>时间</th><th>Topic</th><th>消息</th><th>状态</th></tr></thead><tbody>' +
      history.map(function (h) {
        var payloadShort = h.payload.length > 60 ? h.payload.substring(0, 60) + '...' : h.payload;
        return '<tr>' +
          '<td>' + h.time + '</td>' +
          '<td><code>' + h.topic + '</code></td>' +
          '<td><code>' + payloadShort + '</code></td>' +
          '<td>' + (h.ok ? '<span class="badge badge-success">成功</span>' : '<span class="badge badge-danger">失败</span>') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  App.Router.register('ctrl', render);
})();
