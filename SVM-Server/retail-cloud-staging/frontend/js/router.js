/**
 * Hash-based SPA Router
 * 挂载到 window.RetailApp.Router
 */
(function () {
  'use strict';

  var routes = {};
  var current = 'dashboard';
  var container = null;

  function activateLink(name) {
    document.querySelectorAll('#sidebar a[data-route]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === name);
    });
  }

  var Router = {
    routes: routes,

    register: function (name, renderFn) {
      routes[name] = renderFn;
    },

    navigate: function (name) {
      location.hash = '#' + name;
    },

    init: function () {
      container = document.getElementById('view-container');
      var self = this;
      window.addEventListener('hashchange', function () { self._handle(); });
      this._handle();
    },

    _handle: function () {
      var name = location.hash.slice(1) || 'dashboard';
      if (!routes[name]) name = 'dashboard';
      current = name;

      // Clear and render
      if (container) {
        // Stop any running intervals from previous view
        if (window.RetailApp._intervals) {
          window.RetailApp._intervals.forEach(clearInterval);
        }
        window.RetailApp._intervals = [];
        window.RetailApp._mqttOff = window.RetailApp._mqttOff || [];
        window.RetailApp._mqttOff.forEach(function (fn) { try { fn(); } catch (e) {} });
        window.RetailApp._mqttOff = [];

        container.innerHTML = '';
        routes[name](container);
      }

      activateLink(name);
    },

    getCurrent: function () {
      return current;
    },
  };

  window.RetailApp = window.RetailApp || {};
  window.RetailApp.Router = Router;
})();
