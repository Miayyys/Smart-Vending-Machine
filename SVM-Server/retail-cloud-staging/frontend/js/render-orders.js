/**
 * Order Management View — 订单管理
 * 设备筛选 + 订单列表（可展开查看明细）
 */
(function () {
  'use strict';

  var App = window.RetailApp;
  var API = App.API;
  var refreshTimer = null;

  function render(container) {
    container.innerHTML =
      '<div class="orders-view">' +
        '<div class="toolbar">' +
          '<div class="toolbar-left">' +
            '<label>设备：</label>' +
            '<select id="order-cabinet">' +
              '<option value="">全部设备</option>' +
              App.cabinets.map(function (c) {
                return '<option value="' + c.id + '">' + c.name + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="toolbar-right">' +
            '<button class="btn btn-sm" id="order-refresh-btn">刷新</button> ' +
            '<button class="btn btn-sm btn-danger" id="order-clear-btn">清空全部</button>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap" id="orders-table"></div>' +
      '</div>';

    document.getElementById('order-cabinet').addEventListener('change', loadOrders);
    document.getElementById('order-refresh-btn').addEventListener('click', loadOrders);
    document.getElementById('order-clear-btn').addEventListener('click', clearAll);

    loadOrders();

    // MQTT settle events
    var onSettle = function () { loadOrders(); };
    App.MQTT.on('retail/+/event/settle', onSettle);
    App._mqttOff.push(function () { App.MQTT.off('retail/+/event/settle', onSettle); });

    refreshTimer = setInterval(loadOrders, 60000);
    App._intervals.push(refreshTimer);
  }

  function clearAll() {
    if (!confirm('确定要清空全部订单吗？\n此操作不可撤销，将删除所有订单及明细！')) return;
    var btn = document.getElementById('order-clear-btn');
    btn.disabled = true;
    btn.textContent = '清空中...';
    API.clearOrders().then(function (r) {
      App.showToast('已清空 ' + (r.deleted || 0) + ' 条订单', 'success');
      loadOrders();
    }).catch(function (err) {
      App.showToast('清空失败: ' + err.message, 'error');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '清空全部';
    });
  }

  function loadOrders() {
    var el = document.getElementById('orders-table');
    if (!el) return;
    var cab = document.getElementById('order-cabinet').value;
    API.getOrders(null).then(function (orders) {
      if (cab) { orders = orders.filter(function (o) { return o.deviceId && o.deviceId.startsWith(cab); }); }
      if (!orders.length) { el.innerHTML = '<div class="empty">暂无订单</div>'; return; }
      el.innerHTML =
        '<table><thead><tr><th>订单ID</th><th>设备</th><th>用户</th><th>金额</th><th>状态</th><th>创建时间</th><th>结算时间</th><th>操作</th></tr></thead><tbody>' +
        orders.map(function (o) {
          return '<tr class="order-row" data-order-id="' + o.id + '">' +
            '<td>' + o.id + '</td>' +
            '<td>' + (App.cabinetName(o.deviceId) || o.deviceId) + '</td>' +
            '<td><span class="user-cell" data-oid="' + o.id + '" data-uid="' + (o.userId || '') + '" title="点击修改用户">' + (o.userId || '未指定') + '</span></td>' +
            '<td>&yen;' + (o.totalAmount || 0).toFixed(2) + '</td>' +
            '<td><span class="badge badge-' + statusClass(o.payStatus) + '">' + (o.payStatus === 'PAID' ? '已支付' : o.payStatus === 'FAILED' ? '失败' : '待支付') + '</span></td>' +
            '<td>' + fmtTime(o.createTime) + '</td>' +
            '<td>' + (o.settleTime ? fmtTime(o.settleTime) : '-') + '</td>' +
            '<td>' +
              '<button class="btn btn-xs expand-btn" data-oid="' + o.id + '" style="margin-right:4px;">展开</button>' +
              (o.payStatus !== 'PAID'
                ? '<button class="btn btn-xs btn-primary pay-btn" data-oid="' + o.id + '">确认付款</button>'
                : '<span class="text-muted" style="font-size:11px;">已结算</span>') +
            '</td>' +
          '</tr>' +
          '<tr class="order-items-row" id="items-' + o.id + '" style="display:none">' +
            '<td colspan="8"><div class="items-loading">加载中...</div></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';

      // 确认付款
      el.querySelectorAll('.pay-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var oid = this.getAttribute('data-oid');
          if (!confirm('确认订单 #' + oid + ' 已付款？')) return;
          this.disabled = true;
          this.textContent = '处理中...';
          API.updateOrder(oid, { payStatus: 'PAID' }).then(function () {
            App.showToast('订单 #' + oid + ' 已结算', 'success');
            loadOrders();
          }).catch(function (err) {
            App.showToast('操作失败: ' + err.message, 'error');
            loadOrders();
          });
        });
      });

      // 修改用户名
      el.querySelectorAll('.user-cell').forEach(function (cell) {
        cell.addEventListener('click', function (e) {
          e.stopPropagation();
          var oid = this.getAttribute('data-oid');
          var cur = this.getAttribute('data-uid') || '';
          var name = prompt('修改用户名：', cur);
          if (name === null) return;
          API.updateOrder(oid, { userId: name }).then(function () {
            App.showToast('用户已更新', 'success');
            loadOrders();
          }).catch(function (err) {
            App.showToast('更新失败: ' + err.message, 'error');
          });
        });
      });

      // Expand/collapse
      el.querySelectorAll('.expand-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var oid = this.getAttribute('data-oid');
          var itemsRow = document.getElementById('items-' + oid);
          if (itemsRow.style.display === 'none') {
            itemsRow.style.display = '';
            this.textContent = '收起';
            loadOrderItems(oid, itemsRow);
          } else {
            itemsRow.style.display = 'none';
            this.textContent = '展开';
          }
        });
      });
    }).catch(function () { el.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function loadOrderItems(orderId, row) {
    var cell = row.querySelector('td');
    API.getOrderItems(orderId).then(function (items) {
      if (!items.length) { cell.innerHTML = '<div class="empty">无明细</div>'; return; }
      cell.innerHTML =
        '<table class="inner-table"><thead><tr><th>商品</th><th>单价</th><th>数量</th><th>小计</th></tr></thead><tbody>' +
        items.map(function (it) {
          var p = App.productMap[it.productId] || { name: '未知#' + it.productId };
          return '<tr>' +
            '<td>' + p.name + '</td>' +
            '<td>&yen;' + (it.price || 0).toFixed(2) + '</td>' +
            '<td>' + it.qty + '</td>' +
            '<td>&yen;' + (it.subtotal || 0).toFixed(2) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }).catch(function () { cell.innerHTML = '<div class="empty">加载失败</div>'; });
  }

  function statusClass(s) { return s === 'PAID' ? 'success' : s === 'FAILED' ? 'danger' : 'warn'; }
  function fmtTime(t) { return t ? t.replace('T', ' ').substring(0, 19) : ''; }

  App.Router.register('orders', render);
})();
