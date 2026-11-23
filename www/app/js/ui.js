// Shared UI helpers used by every KABAZA screen.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(value) {
    var n = Number(value || 0);
    try {
      return 'MK ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    } catch (e) {
      return 'MK ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  function date(value, opts) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('en-MW', opts || {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return String(value);
    }
  }

  function timeAgo(value) {
    if (!value) return '';
    var diff = Date.now() - new Date(value).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(message, kind) {
    var host = qs('#toast-host');
    if (!host) {
      host = el('<div id="toast-host" class="toast-host"></div>');
      document.body.appendChild(host);
    }
    var node = el('<div class="toast toast--' + esc(kind || 'info') + '">' + esc(message) + '</div>');
    host.appendChild(node);
    requestAnimationFrame(function () { node.classList.add('is-in'); });
    setTimeout(function () {
      node.classList.remove('is-in');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 250);
    }, 3600);
  }

  function modal(title, bodyHtml, actionsHtml, captureValues) {
    return new Promise(function (resolve) {
      var overlay = el(
        '<div class="modal-overlay">' +
          '<div class="modal" role="dialog" aria-modal="true">' +
            '<div class="modal__head"><h3>' + esc(title) + '</h3>' +
              '<button class="icon-btn" data-close aria-label="Close">&times;</button></div>' +
            '<div class="modal__body">' + (bodyHtml || '') + '</div>' +
            '<div class="modal__foot">' + (actionsHtml ||
              '<button class="btn btn--ghost" data-close>Close</button>') + '</div>' +
          '</div></div>'
      );
      function done(value) {
        // Capture field values BEFORE the overlay is removed, otherwise callers
        // cannot read what the user typed once the modal promise resolves.
        var scope = qs('form', overlay) || qs('.modal__body', overlay) || overlay;
        var values = formValues(scope);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(captureValues ? { action: value, values: values } : value);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-close]')) done(null);
        var action = e.target.closest('[data-action]');
        if (action) done(action.getAttribute('data-action'));
      });
      document.body.appendChild(overlay);
      var first = qs('input, select, textarea, button', overlay);
      if (first) first.focus();
    });
  }

  // Like modal(), but resolves to { action, values } with the form fields read
  // before the dialog closes. Use for any modal that collects input.
  function formModal(title, bodyHtml, actionsHtml) {
    return modal(title, bodyHtml, actionsHtml, true);
  }

  function confirm(title, message, okLabel) {
    return modal(title,
      '<p class="muted">' + esc(message) + '</p>',
      '<button class="btn btn--ghost" data-close>Cancel</button>' +
      '<button class="btn btn--primary" data-action="ok">' + esc(okLabel || 'Confirm') + '</button>'
    ).then(function (v) { return v === 'ok'; });
  }

  function loading(label) {
    return '<div class="empty-state"><div class="spinner"></div><p>' +
      esc(label || 'Loading…') + '</p></div>';
  }

  function empty(title, message, actionHtml) {
    return '<div class="empty-state">' +
      '<div class="empty-state__icon">◌</div>' +
      '<h3>' + esc(title) + '</h3>' +
      (message ? '<p class="muted">' + esc(message) + '</p>' : '') +
      (actionHtml || '') + '</div>';
  }

  function statusPill(status) {
    var map = {
      pending: 'Pending', accepted: 'Accepted', arriving: 'Arriving',
      picked_up: 'Picked up', in_transit: 'On the way', completed: 'Completed',
      cancelled: 'Cancelled', unpaid: 'Unpaid', paid: 'Paid', failed: 'Failed',
      offline: 'Offline', online: 'Online', pending_approval: 'Awaiting approval'
    };
    return '<span class="pill pill--' + esc(status) + '">' +
      esc(map[status] || status || '—') + '</span>';
  }

  function sourceBadge(product) {
    var source = String((product && product.source) || 'kabaza').toLowerCase();
    var label = (product && product.source_label) ||
      (source === 'partner' ? 'Bought elsewhere' : 'In KABAZA stock');
    return '<span class="source-badge source-badge--' + esc(source) + '">' +
      esc(label) + '</span>';
  }

  function ageBadge() {
    return '<span class="age-badge" title="18+ only">18+</span>';
  }

  function avatar(name, url, size) {
    var initials = String(name || '?').trim().split(/\s+/).map(function (p) {
      return p.charAt(0);
    }).slice(0, 2).join('').toUpperCase();
    if (url) {
      return '<img class="avatar" style="width:' + (size || 40) + 'px;height:' +
        (size || 40) + 'px" src="' + esc(url) + '" alt="' + esc(name) + '">';
    }
    return '<span class="avatar avatar--initials" style="width:' + (size || 40) +
      'px;height:' + (size || 40) + 'px">' + esc(initials) + '</span>';
  }

  function field(label, name, opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var input;
    if (type === 'textarea') {
      input = '<textarea class="input" name="' + esc(name) + '" rows="' +
        (opts.rows || 3) + '" placeholder="' + esc(opts.placeholder || '') + '">' +
        esc(opts.value || '') + '</textarea>';
    } else if (type === 'select') {
      input = '<select class="input" name="' + esc(name) + '">' +
        (opts.options || []).map(function (o) {
          var val = typeof o === 'string' ? o : o.value;
          var lab = typeof o === 'string' ? o : o.label;
          return '<option value="' + esc(val) + '"' +
            (String(val) === String(opts.value) ? ' selected' : '') + '>' +
            esc(lab) + '</option>';
        }).join('') + '</select>';
    } else {
      input = '<input class="input" type="' + esc(type) + '" name="' + esc(name) +
        '" value="' + esc(opts.value == null ? '' : opts.value) + '"' +
        ' placeholder="' + esc(opts.placeholder || '') + '"' +
        (opts.required ? ' required' : '') +
        (opts.step ? ' step="' + esc(opts.step) + '"' : '') +
        (opts.min != null ? ' min="' + esc(opts.min) + '"' : '') + '>';
    }
    return '<label class="field"><span>' + esc(label) + '</span>' + input + '</label>';
  }

  function formValues(form) {
    var out = {};
    qsa('[name]', form).forEach(function (input) {
      // Only the checked radio in a group contributes its value. Without this,
      // the last radio (e.g. "cash" or "admin") would always win.
      if (input.type === 'radio' && !input.checked) return;
      out[input.name] = input.type === 'checkbox' ? input.checked : input.value.trim();
    });
    return out;
  }

  function section(title, subtitle, actions) {
    return '<div class="section-head"><div><h2>' + esc(title) + '</h2>' +
      (subtitle ? '<p class="muted">' + esc(subtitle) + '</p>' : '') + '</div>' +
      (actions ? '<div class="section-actions">' + actions + '</div>' : '') + '</div>';
  }

  function card(inner, cls) {
    return '<div class="card ' + esc(cls || '') + '">' + inner + '</div>';
  }

  function on(root, event, selector, handler) {
    // Screens re-render into the same #main element. Replace any previous
    // delegated handler for the same event/selector so a single user action
    // never fires multiple times (which would duplicate ledger writes).
    var key = '__kbz_' + event + '_' + selector;
    var previous = root[key];
    if (previous) root.removeEventListener(event, previous);
    var listener = function (e) {
      var target = e.target.closest(selector);
      if (target && root.contains(target)) handler.call(target, e, target);
    };
    root[key] = listener;
    root.addEventListener(event, listener);
  }

  function copy(text) {
    try {
      navigator.clipboard.writeText(text);
      toast('Copied to clipboard', 'success');
    } catch (e) {
      toast('Could not copy', 'error');
    }
  }

  KBZ.ui = {
    esc: esc, money: money, date: date, timeAgo: timeAgo, el: el, qs: qs, qsa: qsa,
    toast: toast, modal: modal, formModal: formModal, confirm: confirm, loading: loading, empty: empty,
    statusPill: statusPill, sourceBadge: sourceBadge, ageBadge: ageBadge,
    avatar: avatar, field: field, formValues: formValues, section: section,
    card: card, on: on, copy: copy
  };
})();
