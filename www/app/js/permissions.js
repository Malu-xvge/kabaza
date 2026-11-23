// Runtime permission requests for the native APK.
// Android's location permission is declared in AndroidManifest.xml. Calling
// geolocation once makes the system show its runtime dialog; afterwards the
// same API powers pickup maps and rider location updates.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var KEY = 'kbz_location_prompted_v1';

  function isNative() {
    return Boolean(window.Capacitor) || /Capacitor/i.test(navigator.userAgent || '');
  }

  function alreadyPrompted() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function markPrompted() {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
  }

  function requestLocation(options) {
    options = options || {};
    if (!isNative()) return Promise.resolve({ native: false, skipped: true });
    if (!navigator.geolocation || !navigator.geolocation.getCurrentPosition) {
      return Promise.resolve({ native: true, error: 'unavailable' });
    }
    return new Promise(function (resolve) {
      try {
        navigator.geolocation.getCurrentPosition(function (pos) {
          markPrompted();
          resolve({
            native: true,
            granted: true,
            lat: pos && pos.coords ? pos.coords.latitude : null,
            lng: pos && pos.coords ? pos.coords.longitude : null
          });
        }, function (err) {
          markPrompted();
          resolve({ native: true, granted: false, code: err && err.code });
        }, {
          enableHighAccuracy: Boolean(options.highAccuracy),
          timeout: 12000,
          maximumAge: 600000
        });
      } catch (e) {
        markPrompted();
        resolve({ native: true, error: 'failed' });
      }
    });
  }

  function ensureLocation() {
    if (!isNative() || alreadyPrompted()) return Promise.resolve({ skipped: true });
    return requestLocation();
  }

  KBZ.permissions = {
    isNative: isNative,
    requestLocation: requestLocation,
    ensureLocation: ensureLocation,
    alreadyPrompted: alreadyPrompted
  };
})();
