// Marketing site behaviour.
(function () {
  'use strict';

  // Inside the native APK, skip the marketing page and open the app directly.
  if (window.Capacitor || (window.location.protocol === 'capacitor:' ||
      /^https:\/\/localhost/i.test(window.location.href) && navigator.userAgent.indexOf('Capacitor') > -1)) {
    window.location.replace('app/index.html');
    return;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    var toggle = document.getElementById('menu-toggle');
    var menu = document.getElementById('mobile-menu');
    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        menu.classList.toggle('is-open');
      });
      menu.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') menu.classList.remove('is-open');
      });
    }
  });
})();
