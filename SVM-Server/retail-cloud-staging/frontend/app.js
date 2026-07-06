/**
 * App Bootstrap — 初始化全局状态、加载产品映射、启动路由和 MQTT
 */
(function () {
  'use strict';

  var App = window.RetailApp;

  // ── 全局状态 ──
  App.productMap = {};   // { productId: { name, sku, price, weightGram, imageUrl } }
  App.cabinets = [
    { id: 'D01', name: '1号柜', location: '教学楼A栋1层' },
    { id: 'D02', name: '2号柜', location: '图书馆2层' },
  ];
  App.floors = [1];   // 每个柜子只有一个摄像头/一层

  /** 根据柜号+楼层构建 device ID */
  App.buildDeviceId = function (cabinetId, floor) {
    return cabinetId + '-F' + floor;
  };

  /** 根据 device ID 反查显示名 */
  App.deviceName = function (deviceId) {
    var cab = App.cabinets.find(function (c) { return deviceId && deviceId.startsWith(c.id); });
    return cab ? cab.name : (deviceId || '');
  };

  /** 根据 device ID 反查柜名（不带楼层） */
  App.cabinetName = function (deviceId) {
    var cab = App.cabinets.find(function (c) { return deviceId && deviceId.startsWith(c.id); });
    return cab ? cab.name : (deviceId || '');
  };

  // 保留扁平列表供仪表盘统计等场景
  App.deviceList = [];
  App.cabinets.forEach(function (cab) {
    App.floors.forEach(function (f) {
      var did = App.buildDeviceId(cab.id, f);
      App.deviceList.push({ id: did, name: App.deviceName(did), location: cab.location });
    });
  });
  App._intervals = [];
  App._mqttOff = [];

  function showToast(msg, type) {
    var toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'toast toast-' + (type || 'info') + ' show';
    clearTimeout(toast._tid);
    toast._tid = setTimeout(function () { toast.classList.remove('show'); }, 3000);
  }

  function initProductMap() {
    return App.API.getProducts().then(function (products) {
      products.forEach(function (p) {
        App.productMap[p.id] = {
          name: p.name,
          sku: p.sku,
          price: p.price,
          weightGram: p.weightGram,
        };
      });
      console.log('[App] Product map loaded:', Object.keys(App.productMap).length, 'items');
    }).catch(function (err) {
      console.error('[App] Failed to load products:', err);
      showToast('加载商品数据失败', 'error');
    });
  }

  // ── 启动流程 ──
  function boot() {
    // 移动端菜单切换
    var toggle = document.getElementById('menu-toggle');
    var sidebar = document.getElementById('sidebar');
    if (toggle && sidebar) {
      toggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
      });
      // 点击侧边栏链接后自动收起
      sidebar.querySelectorAll('a[data-route]').forEach(function (a) {
        a.addEventListener('click', function () { sidebar.classList.remove('open'); });
      });
      // 点击主内容区收起菜单
      document.getElementById('view-container').addEventListener('click', function () {
        sidebar.classList.remove('open');
      });
    }

    showToast('正在加载数据...', 'info');

    initProductMap().then(function () {
      // 初始化 MQTT
      if (typeof mqtt !== 'undefined') {
        App.MQTT.init();
      } else {
        console.warn('[App] mqtt.js not loaded — real-time updates disabled');
      }

      // 启动路由
      App.Router.init();
      showToast('系统就绪', 'success');
    });
  }

  // 暴露工具方法
  App.showToast = showToast;

  // DOM ready 后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
