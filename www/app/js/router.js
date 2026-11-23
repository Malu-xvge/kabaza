// Tiny hash router. No framework, works offline inside the APK WebView.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var routes = [];
  var notFound = null;
  var current = null;

  function parse() {
    var hash = String(location.hash || '').replace(/^#\/?/, '');
    var parts = hash.split('?');
    var path = parts[0] || 'home';
    var query = {};
    (parts[1] || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split('=');
      query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return { path: path, segments: path.split('/').filter(Boolean), query: query };
  }

  function add(pattern, handler) {
    routes.push({ pattern: pattern, handler: handler });
  }

  function setNotFound(handler) { notFound = handler; }

  function match(pattern, segments) {
    var p = pattern.split('/').filter(Boolean);
    if (p.length !== segments.length) return null;
    var params = {};
    for (var i = 0; i < p.length; i++) {
      if (p[i].charAt(0) === ':') params[p[i].slice(1)] = decodeURIComponent(segments[i]);
      else if (p[i] !== segments[i]) return null;
    }
    return params;
  }

  async function resolve() {
    var info = parse();
    var matched = null;
    for (var i = 0; i < routes.length; i++) {
      var params = match(routes[i].pattern, info.segments);
      if (params) { matched = { route: routes[i], params: params }; break; }
    }
    var ctx = { path: info.path, params: matched ? matched.params : {}, query: info.query };
    current = ctx;
    try {
      if (matched) await matched.route.handler(ctx);
      else if (notFound) await notFound(ctx);
    } catch (err) {
      console.error('Route error', err);
      var main = document.getElementById('main');
      if (main) {
        main.innerHTML = '<div class="empty-state"><h3>Something went wrong</h3><p class="muted">' +
          KBZ.ui.esc(err && err.message ? err.message : String(err)) + '</p>' +
          '<button class="btn btn--primary" onclick="location.hash=\'#/home\'">Go home</button></div>';
      }
    }
  }

  function go(path) {
    if (String(location.hash) === '#/' + path || String(location.hash) === '#' + path) {
      resolve();
    } else {
      location.hash = '#/' + path;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function link(path, label, cls) {
    return '<a href="#/' + KBZ.ui.esc(path) + '" class="' + KBZ.ui.esc(cls || '') + '">' +
      KBZ.ui.esc(label) + '</a>';
  }

  window.addEventListener('hashchange', resolve);

  KBZ.router = { add: add, setNotFound: setNotFound, resolve: resolve, go: go, link: link, current: function () { return current; } };
})();
