/**
 * MQTT WebSocket Client — 实时事件订阅
 * 挂载到 window.RetailApp.MQTT
 * 依赖：mqtt.js CDN（全局 mqtt 变量）
 */
(function () {
  'use strict';

  // 部署时修改为实际 MQTT 账号密码（需与 EMQX 配置一致）
  const MQTT_USERNAME = 'retail_ui';
  const MQTT_PASSWORD = 'your-mqtt-password';
  const TOPICS = ['retail/+/event/stock_detected', 'retail/+/event/ota_progress', 'retail/+/event/anomaly', 'retail/+/msg/err'];

  const listeners = {}; // { topicPattern: [callback] }

  function matchPattern(pattern, topic) {
    const pp = pattern.split('/');
    const tp = topic.split('/');
    if (pp.length !== tp.length) return false;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i] === '+') continue;
      if (pp[i] !== tp[i]) return false;
    }
    return true;
  }

  function dispatch(topic, payload) {
    Object.keys(listeners).forEach(function (pat) {
      if (matchPattern(pat, topic)) {
        listeners[pat].forEach(function (cb) {
          try { cb(topic, payload); } catch (e) { console.error('MQTT listener error:', e); }
        });
      }
    });
  }

  var MQTT = {
    connected: false,
    client: null,

    init: function () {
      // 按页面协议自动选 ws/wss，避免 HTTPS 页面下混合内容被浏览器拦截
      var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
      var wsUrl = proto + location.host + '/mqtt';
      try {
        this.client = mqtt.connect(wsUrl, {
          username: MQTT_USERNAME,
          password: MQTT_PASSWORD,
          clientId: 'retail-frontend-' + Math.random().toString(16).slice(2, 10),
          reconnectPeriod: 5000,
          connectTimeout: 10000,
          clean: true,
        });

        var self = this;
        this.client.on('connect', function () {
          self.connected = true;
          console.log('[MQTT] Connected via WebSocket');
          self.client.subscribe(TOPICS, { qos: 1 }, function (err) {
            if (err) console.error('[MQTT] Subscribe error:', err);
            else console.log('[MQTT] Subscribed to', TOPICS);
          });
          self._updateStatus(true);
        });

        this.client.on('message', function (topic, message) {
          var payload = null;
          try { payload = JSON.parse(message.toString()); } catch (e) { /* raw string */ }
          dispatch(topic, payload);
        });

        this.client.on('close', function () {
          self.connected = false;
          console.warn('[MQTT] Disconnected');
          self._updateStatus(false);
        });

        this.client.on('error', function (err) {
          console.error('[MQTT] Error:', err.message);
        });
      } catch (e) {
        console.error('[MQTT] Init failed:', e);
      }
    },

    on: function (pattern, callback) {
      if (!listeners[pattern]) listeners[pattern] = [];
      listeners[pattern].push(callback);
    },

    off: function (pattern, callback) {
      if (!listeners[pattern]) return;
      if (callback) {
        listeners[pattern] = listeners[pattern].filter(function (c) { return c !== callback; });
      } else {
        delete listeners[pattern];
      }
    },

    publish: function (topic, payload, qos) {
      var self = this;
      qos = qos || 1;
      var msg = typeof payload === 'string' ? payload : JSON.stringify(payload);

      // 等连接就绪后发送
      function doPublish(resolve, reject) {
        if (!self.client) {
          return reject(new Error('MQTT client 未初始化'));
        }
        // mqtt v5: publish 不带 callback 返回 Promise
        var result = self.client.publish(topic, msg, { qos: qos });
        if (result && typeof result.then === 'function') {
          result.then(function () {
            console.log('[MQTT] Published OK:', topic);
            resolve();
          }).catch(function (err) {
            console.error('[MQTT] Publish error:', err);
            reject(err || new Error('发送失败'));
          });
        } else {
          // 旧版：直接 resolve（fire-and-forget）
          console.log('[MQTT] Published (fire-and-forget):', topic);
          resolve();
        }
      }

      return new Promise(function (resolve, reject) {
        if (self.connected) {
          doPublish(resolve, reject);
        } else {
          // 等连接
          var timeout = setTimeout(function () {
            reject(new Error('MQTT 未连接，请刷新页面'));
          }, 5000);
          self.client.once('connect', function () {
            clearTimeout(timeout);
            self.connected = true;
            doPublish(resolve, reject);
          });
        }
      });
    },

    _updateStatus: function (ok) {
      var el = document.getElementById('mqtt-status');
      if (!el) return;
      el.className = 'mqtt-status ' + (ok ? 'online' : 'offline');
      el.textContent = ok ? 'MQTT 已连接' : 'MQTT 断开';
    },
  };

  window.RetailApp = window.RetailApp || {};
  window.RetailApp.MQTT = MQTT;
})();
