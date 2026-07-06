/**
 * Stock Management View — 库存管理（柜级聚合）
 * 柜号选择器 + 库存表 + 校准弹窗
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var currentCabinet = 'D01';
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="stock-view">' +
        '<div class="toolbar">' +
          '<div class="toolbar-left">' +
            '<label>设备：</label>' +
            '<select id="stock-cabinet">' +
              App.cabinets.map(function (c) {
                var sel = c.id === currentCabinet ? ' selected' : '';
                return '<option value="' + c.id + '"' + sel + '>' + c.name + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="toolbar-right">' +
            '<label class="toggle-label">' +
              '<input type="checkbox" id="stock-low-only"> 仅显示低库存' +
            '</label>' +
            '<button class="btn btn-sm" id="stock-refresh-btn">刷新</button>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap" id="stock-table"></div>' +
      '</div>' +
      '<div class="modal-overlay" id="reconcile-modal" style="display:none">' +
        '<div class="modal">' +
          '<h3>库存校准</h3>' +
          '<div class="form-group"><label>设备</label><span id="rec-device"></span></div>' +
          '<div class="form-group"><label>商品</label><span id="rec-product"></span></div>' +
          '<div class="form-group"><label>当前数量</label><input type="number" id="rec-qty" min="0"></div>' +
          '<div class="form-group"><label>阈值</label><input type="number" id="rec-threshold" min="0"></div>' +
          '<div class="modal-actions">' +
            '<button class="btn" id="rec-cancel">取消</button>' +
            '<button class="btn btn-primary" id="rec-save">保存</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('stock-cabinet').addEventListener('change', function () {
      currentCabinet = this.value;
      loadStock();
    });
    document.getElementById('stock-low-only').addEventListener('change', loadStock);
    document.getElementById('stock-refresh-btn').addEventListener('click', loadStock);
    document.getElementById('rec-cancel').addEventListener('click', closeReconcile);
    document.getElementById('rec-save').addEventListener('click', doReconcile);

    loadStock();

    // MQTT: 实时更新（当前柜的 take 都触发刷新）
    var onTake = function (topic, payload) {
      if (!payload) return;
      var parts = topic.split('/');
      var devId = parts[1];
      if (!devId || !devId.startsWith(currentCabinet)) return;
      // 乐观更新聚合行
      var row = document.querySelector('#stock-table tr[data-pid="' + payload.pid + '"]');
      if (row) {
        var qtyCell = row.querySelector('.qty-cell');
        var delta = payload.act === 'TAKE' ? -(payload.qty || 1) : (payload.qty || 1);
        var curVal = parseInt(qtyCell.textContent, 10) || 0;
        qtyCell.textContent = Math.max(0, curVal + delta);
        row.classList.add('flash');
        setTimeout(function () { row.classList.remove('flash'); }, 1000);
      }
      clearTimeout(window._stockConfirm);
      window._stockConfirm = setTimeout(loadStock, 2000);
    };
    App.MQTT.on('retail/+/event/take', onTake);
    App._mqttOff.push(function () { App.MQTT.off('retail/+/event/take', onTake); });

    // AI 视觉识别完成后自动刷新库存
    var onDetected = function (topic, payload) {
      if (!payload || !payload.deviceId) return;
      if (payload.deviceId.startsWith(currentCabinet)) {
        loadStock();
      }
    };
    App.MQTT.on('retail/+/event/stock_detected', onDetected);
    App._mqttOff.push(function () { App.MQTT.off('retail/+/event/stock_detected', onDetected); });

    // Polling
    refreshTimer = setInterval(loadStock, 60000);
    App._intervals.push(refreshTimer);
  }

  /** 查询当前柜库存 */
  function loadStock() {
    var el = document.getElementById('stock-table');
    if (!el) return;
    var did = App.buildDeviceId(currentCabinet, 1);
    API.getDeviceStock(did).then(function (stock) {
      var lowOnly = document.getElementById('stock-low-only');
      if (lowOnly && lowOnly.checked) {
        stock = stock.filter(function (s) { return s.qty < s.threshold; });
      }
      if (!stock.length) { el.innerHTML = '<div class="empty">暂无库存数据</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>商品</th><th>SKU</th><th>单价</th><th>数量</th><th>阈值</th><th>状态</th><th>更新时间</th></tr></thead><tbody>' +
        stock.map(function (s) {
          var p = App.productMap[s.productId] || { name: '未知#' + s.productId, sku: '' };
          var critical = s.qty === 0;
          var low = !critical && s.qty < s.threshold;
          var cls = critical ? 'row-critical' : low ? 'row-warn' : '';
          var statusBadge = critical ? '<span class="badge badge-danger">缺货</span>'
            : low ? '<span class="badge badge-warn">低库存</span>'
            : '<span class="badge badge-success">正常</span>';
          return '<tr class="' + cls + ' clickable" data-pid="' + s.productId + '">' +
            '<td>' + p.name + '</td>' +
            '<td>' + (p.sku || '-') + '</td>' +
            '<td><span class="price-cell" data-pid="' + s.productId + '" data-price="' + (p.price || 0) + '" style="cursor:pointer;" title="点击修改单价">&yen;' + (p.price || 0).toFixed(2) + ' ✎</span></td>' +
            '<td class="qty-cell">' + s.qty + '</td>' +
            '<td>' + s.threshold + '</td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' + fmtTime(s.updateTime) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      // 单价编辑
      el.querySelectorAll('.price-cell').forEach(function (cell) {
        cell.addEventListener('click', function (e) {
          e.stopPropagation();
          var pid = parseInt(this.getAttribute('data-pid'));
          var curPrice = parseFloat(this.getAttribute('data-price'));
          var newPrice = prompt('修改单价（元）：', curPrice.toFixed(2));
          if (newPrice === null) return;
          var val = parseFloat(newPrice);
          if (isNaN(val) || val < 0) { App.showToast('无效价格', 'error'); return; }
          API.updateProduct(pid, { price: val }).then(function () {
            App.showToast('单价已更新', 'success');
            loadStock();
          }).catch(function (err) {
            App.showToast('更新失败: ' + err.message, 'error');
          });
        });
      });

      el.querySelectorAll('tr.clickable').forEach(function (row) {
        row.addEventListener('click', function () {
          openReconcile(parseInt(row.getAttribute('data-pid'), 10));
        });
      });
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function openReconcile(productId) {
    var modal = document.getElementById('reconcile-modal');
    var p = App.productMap[productId] || { name: '未知' };
    var cab = App.cabinets.find(function (c) { return c.id === currentCabinet; });
    document.getElementById('rec-device').textContent = (cab ? cab.name : currentCabinet);
    document.getElementById('rec-product').textContent = p.name;
    document.getElementById('rec-qty').value = '';
    document.getElementById('rec-threshold').value = '';
    modal.style.display = 'flex';
    modal._pid = productId;
    modal._cab = currentCabinet;
  }

  function closeReconcile() {
    document.getElementById('reconcile-modal').style.display = 'none';
  }

  /** 校准：直接更新柜库存 */
  function doReconcile() {
    var modal = document.getElementById('reconcile-modal');
    var cab = modal._cab;
    var pid = modal._pid;
    var qty = document.getElementById('rec-qty').value;
    var threshold = document.getElementById('rec-threshold').value;

    var did = App.buildDeviceId(cab, 1);
    API.reconcileStock(did, pid, qty || null, threshold || null).then(function () {
      App.showToast('库存校准成功', 'success');
      closeReconcile();
      loadStock();
    }).catch(function (err) {
      App.showToast('校准失败: ' + err.message, 'error');
    });
  }

  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('stock', render);
})();
