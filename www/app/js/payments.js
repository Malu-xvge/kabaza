// KABAZA mobile-money payments (PayChangu).
// The app never holds the PayChangu secret. It asks server/ to create a
// checkout session, the customer pays, then server/ verifies before we mark
// the order paid. Adapted from the GameNight payments flow.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var ui = KBZ.ui;
  var cfg = window.KBZ_CONFIG || {};
  var POLL_MS = 3000;
  var POLL_FOR = 5 * 60 * 1000;
  var PENDING_KEY = 'kbz_pending_payments';
  var PENDING_MAX = 7 * 24 * 60 * 60 * 1000;

  function apiBase() {
    return String(cfg.paymentApiBase || '').replace(/\/+$/, '');
  }

  function ready() {
    return Boolean(cfg.paymentsEnabled && /^https?:\/\//i.test(apiBase()));
  }

  function readPending() {
    try {
      var v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function writePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20))); } catch (e) {}
  }

  function remember(txRef, orderId) {
    var list = readPending().filter(function (p) { return p.txRef !== txRef; });
    list.push({ txRef: txRef, orderId: orderId, at: Date.now() });
    writePending(list);
  }

  function forget(txRef) {
    writePending(readPending().filter(function (p) { return p.txRef !== txRef; }));
  }

  async function request(path, options) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 60000) : null;
    try {
      var res = await fetch(apiBase() + path, Object.assign({}, options || {}, {
        signal: controller ? controller.signal : undefined,
        headers: Object.assign({ Accept: 'application/json' }, (options && options.headers) || {})
      }));
      var body = await res.json().catch(function () { return null; });
      if (!res.ok) {
        var err = new Error((body && (body.message || body.error)) || ('HTTP ' + res.status));
        err.code = (body && body.error) || 'http';
        throw err;
      }
      return body;
    } catch (e) {
      if (e && e.code) throw e;
      var net = new Error('network');
      net.code = 'network';
      throw net;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function openCheckout(url) {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      return window.Capacitor.Plugins.Browser.open({ url: url, presentationStyle: 'fullscreen' });
    }
    var win = window.open(url, '_blank');
    if (!win) window.location.href = url;
    return Promise.resolve();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function stageText(stage) {
    return ({
      starting: 'Starting payment…',
      opening: 'Opening secure checkout…',
      waiting: 'Complete the payment on the checkout page, then come back here.',
      checking: 'Checking your payment…',
      simulating: 'Waiting for mobile money confirmation…'
    })[stage] || '';
  }

  function errorText(err) {
    var code = err && err.code;
    if (code === 'unavailable') return err.message;
    if (code === 'timeout') return 'We have not seen the payment yet. Open the order again to check.';
    if (code === 'failed' || code === 'cancelled' || code === 'reversed') {
      return 'Payment was not completed. You can try again.';
    }
    if (code === 'init_failed') return 'Could not start the payment. Check your connection and try again.';
    if (code === 'network') return 'No connection to the payment service. Check your internet and try again.';
    return (err && err.message) || 'Could not confirm the payment. Please try again.';
  }

  // ---- Demo checkout -----------------------------------------------------
  // When no backend is configured, show a mock PayChangu-style sheet so the
  // whole order flow can be tested locally without real money.
  function demoCheckout(order, onStage) {
    return new Promise(function (resolve, reject) {
      var txRef = 'kbz_demo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      var body =
        '<div class="pay-sheet">' +
          '<div class="pay-sheet__brand">PayChangu <span class="pay-sheet__demo">DEMO</span></div>' +
          '<div class="pay-sheet__amount">' + ui.money(order.total) + '</div>' +
          '<p class="muted">Pay with mobile money · <strong>' + ui.esc(order.order_number || order.id) + '</strong></p>' +
          '<div class="pay-sheet__methods">' +
            '<button class="pay-method" data-method="TNM Mpamba">📱 TNM Mpamba</button>' +
            '<button class="pay-method" data-method="Airtel Money">📲 Airtel Money</button>' +
          '</div>' +
          '<label class="field"><span>Phone number</span><input class="input" name="phone" value="+265 999 000 000"></label>' +
          '<button class="btn btn--primary btn--block" data-pay>Confirm payment</button>' +
          '<button class="btn btn--ghost btn--block" data-cancel>Cancel</button>' +
          '<p class="fineprint">Demo only — no real money is charged.</p>' +
        '</div>';

      var overlay = ui.el('<div class="modal-overlay"><div class="modal modal--pay">' +
        '<div class="modal__head"><h3>Mobile money checkout</h3>' +
        '<button class="icon-btn" data-cancel aria-label="Close">&times;</button></div>' +
        '<div class="modal__body">' + body + '</div></div></div>');

      function done(value) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      overlay.addEventListener('click', function (e) {
        var methodBtn = e.target.closest('[data-method]');
        if (methodBtn) {
          ui.qsa('.pay-method', overlay).forEach(function (b) { b.classList.remove('is-selected'); });
          methodBtn.classList.add('is-selected');
        }
        if (e.target.closest('[data-cancel]')) {
          done();
          var err = new Error('cancelled');
          err.code = 'cancelled';
          reject(err);
        }
        if (e.target.closest('[data-pay]')) {
          var phone = ui.qs('input[name="phone"]', overlay).value;
          if (!/^(\+?265|0)?\s?9\d{2}\s?\d{3}\s?\d{3}$/.test(phone.replace(/\s/g, ''))) {
            ui.toast('Enter a valid Malawian phone number', 'error');
            return;
          }
          done();
          if (onStage) onStage('simulating');
          setTimeout(function () {
            remember(txRef, order.id);
            KBZ.db.savePayment({
              tx_ref: txRef, order_id: order.id, amount: order.total,
              currency: 'MWK', provider: 'paychangu-demo', status: 'success',
              verified_at: new Date().toISOString(), raw: { phone: phone, demo: true }
            }).then(function () {
              return KBZ.db.updateOrder(order.id, { payment_status: 'paid', tx_ref: txRef });
            }).then(function () {
              forget(txRef);
              KBZ.db.appendLedger({
                entity_type: 'payment', entity_id: order.id, event_type: 'paid',
                payload: { tx_ref: txRef, amount: order.total, provider: 'demo' },
                actor_id: order.customer_id
              });
              resolve({ status: 'success', txRef: txRef, orderId: order.id, amount: order.total });
            }).catch(reject);
          }, 1100);
        }
      });
      document.body.appendChild(overlay);
    });
  }

  async function payForOrder(order, onStage) {
    if (!ready()) {
      if (KBZ.db.isDemo()) return demoCheckout(order, onStage);
      var err = new Error('Payments are not configured yet. Ask the administrator to set up the payment service.');
      err.code = 'unavailable';
      throw err;
    }

    if (onStage) onStage('starting');
    var init = await request('/api/payment/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id })
    });
    if (!init || !init.txRef || !init.checkoutUrl) {
      var bad = new Error('init_failed');
      bad.code = 'init_failed';
      throw bad;
    }

    if (onStage) onStage('opening');
    await openCheckout(init.checkoutUrl);
    if (onStage) onStage('waiting');
    remember(init.txRef, order.id);

    var deadline = Date.now() + POLL_FOR;
    while (Date.now() < deadline) {
      var result = null;
      try {
        result = await request('/api/payment/verify/' + encodeURIComponent(init.txRef));
      } catch (e) {
        if (e && e.code === 'unknown_tx_ref') throw e;
        if (onStage) onStage('checking');
        await sleep(POLL_MS);
        continue;
      }
      var status = String((result && result.status) || 'pending').toLowerCase();
      if (status === 'success') {
        forget(init.txRef);
        return result;
      }
      if (status === 'failed' || status === 'cancelled' || status === 'reversed') {
        forget(init.txRef);
        var fail = new Error('payment_' + status);
        fail.code = status;
        throw fail;
      }
      await sleep(POLL_MS);
    }
    var timeout = new Error('payment_timeout');
    timeout.code = 'timeout';
    throw timeout;
  }

  async function resumePending() {
    if (!ready()) return;
    var pending = readPending();
    var now = Date.now();
    for (var i = 0; i < pending.length; i++) {
      var p = pending[i];
      if (!p || !p.txRef) continue;
      if (now - (p.at || 0) > PENDING_MAX) { forget(p.txRef); continue; }
      try {
        var result = await request('/api/payment/verify/' + encodeURIComponent(p.txRef));
        if (String(result.status).toLowerCase() === 'success') {
          await KBZ.db.updateOrder(p.orderId, { payment_status: 'paid' });
          forget(p.txRef);
        }
      } catch (e) {
        if (e && e.code === 'unknown_tx_ref') forget(p.txRef);
      }
    }
  }

  KBZ.payments = {
    ready: ready, payForOrder: payForOrder, resumePending: resumePending,
    stageText: stageText, errorText: errorText, readPending: readPending
  };
})();
