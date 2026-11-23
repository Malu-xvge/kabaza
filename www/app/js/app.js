// KABAZA app bootstrap + shell.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var ui = KBZ.ui;
  var db = KBZ.db;
  var router = KBZ.router;
  var session = null;
  var booted = false;

  var NAV = {
    customer: [
      { path: 'home', label: 'Home', icon: '⌂' },
      { path: 'ride', label: 'Ride', icon: '🏍' },
      { path: 'delivery', label: 'Delivery', icon: '📦' },
      { path: 'shop', label: 'Shop', icon: '🛍' },
      { path: 'orders', label: 'Orders', icon: '🧾' },
      { path: 'profile', label: 'Profile', icon: '☻' }
    ],
    rider: [
      { path: 'rider', label: 'Jobs', icon: '🏍' },
      { path: 'rider/earnings', label: 'Earnings', icon: '💰' },
      { path: 'profile', label: 'Profile', icon: '☻' }
    ],
    admin: [
      { path: 'admin', label: 'Dashboard', icon: '▦' },
      { path: 'admin/products', label: 'Products', icon: '🏷' },
      { path: 'admin/vendors', label: 'Vendors', icon: '🏬' },
      { path: 'admin/orders', label: 'Orders', icon: '🧾' },
      { path: 'admin/riders', label: 'Riders', icon: '🏍' },
      { path: 'admin/users', label: 'Users', icon: '👥' },
      { path: 'admin/zones', label: 'Zones & pricing', icon: '📍' },
      { path: 'admin/ledger', label: 'Provenance', icon: '⛓' },
      { path: 'admin/settings', label: 'Settings', icon: '⚙' }
    ]
  };

  function role() {
    return (session && session.profile && session.profile.role) || 'customer';
  }

  async function postApi(path, payload) {
    var base = String((window.KBZ_CONFIG || {}).paymentApiBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('Account service unavailable');
    var response = await fetch(base + path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.message || 'Request failed');
    return body;
  }

  // One sign-out path for every control (topbar, sidebar, APK). db.signOut()
  // clears local auth state even when the network call is slow or fails.
  function maybePromptLocation() {
    if (KBZ.permissions && session) {
      KBZ.permissions.ensureLocation().catch(function (e) {
        console.warn('[KABAZA] location permission prompt skipped', e);
      });
    }
  }

  async function doSignOut() {
    try {
      await db.signOut();
    } catch (err) {
      console.warn('[KABAZA] sign-out fallback:', err && err.message);
    }
    session = null;
    location.hash = '#/login';
    renderLogin();
    ui.toast('Signed out', 'success');
  }

  function renderShell(activePath) {
    var app = document.getElementById('app');
    var r = role();
    var items = NAV[r] || NAV.customer;
    var p = session && session.profile;
    var demo = db.isDemo();

    app.innerHTML =
      '<div class="app-shell app-shell--' + ui.esc(r) + '">' +
        '<header class="topbar">' +
          '<button class="icon-btn menu-btn" id="menu-toggle" aria-label="Menu">☰</button>' +
          '<a href="#/' + (r === 'admin' ? 'admin' : r === 'rider' ? 'rider' : 'home') + '" class="brand">' +
            '<span class="brand__mark">K</span><span class="brand__word">KABAZA</span>' +
          '</a>' +
          '<span class="topbar__badge">' + (demo ? 'DEMO MODE' : ui.esc(r.toUpperCase())) + '</span>' +
          '<div class="topbar__spacer"></div>' +
          '<button class="topbar__user" id="user-btn">' +
            ui.avatar(p && p.full_name, p && p.avatar_url, 34) +
            '<span class="topbar__user-name">' + ui.esc((p && p.full_name) || 'Account') + '</span>' +
            '<span class="caret">▾</span>' +
          '</button>' +
          '<button class="icon-btn topbar__logout" id="topbar-sign-out" title="Sign out" aria-label="Sign out">↪</button>' +
        '</header>' +
        '<div class="app-body">' +
          '<aside class="sidebar" id="sidebar">' +
            '<div class="sidebar__label">KABAZA</div>' +
            items.map(function (item) {
              var active = activePath === item.path || (item.path !== 'admin' && activePath.indexOf(item.path) === 0) ||
                (item.path === 'admin' && activePath.indexOf('admin') === 0 &&
                  ['admin/products','admin/vendors','admin/orders','admin/riders','admin/users','admin/zones','admin/ledger','admin/settings'].indexOf(activePath) === -1);
              return '<a href="#/' + item.path + '" class="nav-item' + (active ? ' is-active' : '') + '">' +
                '<span class="nav-item__icon">' + item.icon + '</span><span>' + ui.esc(item.label) + '</span></a>';
            }).join('') +
            '<div class="sidebar__foot">' +
              '<button class="nav-item nav-item--danger" id="switch-role">' +
                '<span class="nav-item__icon">⇄</span><span>Switch role</span></button>' +
              '<button class="nav-item" id="sign-out">' +
                '<span class="nav-item__icon">↪</span><span>Sign out</span></button>' +
            '</div>' +
          '</aside>' +
          '<main class="main" id="main"></main>' +
        '</div>' +
        '<nav class="bottom-nav">' +
          items.slice(0, 5).map(function (item) {
            var active = activePath === item.path || (item.path !== 'admin' && activePath.indexOf(item.path) === 0);
            return '<a href="#/' + item.path + '" class="bottom-nav__item' + (active ? ' is-active' : '') + '">' +
              '<span class="bottom-nav__icon">' + item.icon + '</span>' +
              '<span>' + ui.esc(item.label) + '</span></a>';
          }).join('') +
        '</nav>' +
      '</div>';

    var toggle = document.getElementById('menu-toggle');
    if (toggle) toggle.addEventListener('click', function () {
      document.getElementById('sidebar').classList.toggle('is-open');
    });

    var userBtn = document.getElementById('user-btn');
    if (userBtn) userBtn.addEventListener('click', function () {
      router.go('profile');
    });

    var signOut = document.getElementById('sign-out');
    if (signOut) signOut.addEventListener('click', doSignOut);
    var topbarSignOut = document.getElementById('topbar-sign-out');
    if (topbarSignOut) topbarSignOut.addEventListener('click', doSignOut);

    var switchRole = document.getElementById('switch-role');
    if (switchRole) switchRole.addEventListener('click', function () {
      ui.modal('Switch role',
        '<p class="muted">Choose which side of KABAZA you want to explore.' +
        (db.isDemo() ? ' In demo mode this is instant.' : ' In live mode your account role must be changed by an admin.') + '</p>',
        '<button class="btn btn--ghost" data-action="customer">Customer</button>' +
        '<button class="btn btn--ghost" data-action="rider">Rider</button>' +
        '<button class="btn btn--primary" data-action="admin">Admin</button>'
      ).then(async function (choice) {
        if (!choice) return;
        if (db.isDemo()) {
          session.profile.role = choice;
          await db.updateProfile(session.profile.id, { role: choice });
        } else {
          ui.toast('Ask an admin to change your role', 'error');
          return;
        }
        location.hash = '#/' + (choice === 'admin' ? 'admin' : choice === 'rider' ? 'rider' : 'home');
        router.resolve();
        ui.toast('Switched to ' + choice, 'success');
      });
    });
  }

  function renderLogin() {
    var app = document.getElementById('app');
    app.innerHTML =
      '<div class="login-page">' +
        '<div class="login-art">' +
          '<a href="../index.html" class="brand brand--light"><span class="brand__mark">K</span>' +
          '<span class="brand__word">KABAZA</span></a>' +
          '<div class="login-art__copy">' +
            '<h1>Move Salima.<br><span>One ride at a time.</span></h1>' +
            '<p>Rides, deliveries, food, groceries and your favourite drinks — ordered from one place.</p>' +
          '</div>' +
          '<div class="login-art__stats">' +
            '<div><strong>Salima</strong><span>our first town</span></div>' +
            '<div><strong>18+</strong><span>verified alcohol</span></div>' +
            '<div><strong>24/7</strong><span>riders online</span></div>' +
          '</div>' +
          '<a class="login-art__back" href="../index.html">← Back to website</a>' +
        '</div>' +
        '<div class="login-panel">' +
          '<div class="login-card">' +
            '<div class="login-card__head">' +
              '<h2>Welcome back</h2>' +
              '<p class="muted">Sign in to order a ride, track a delivery or manage KABAZA.</p>' +
            '</div>' +
            (db.isDemo() ?
              '<div class="notice notice--info">Demo mode is on. Enter any email and password, then choose a role below to explore the customer app, rider app and admin console.</div>' : '') +
            '<form id="login-form">' +
              ui.field('Email address', 'email', { type: 'email', placeholder: 'you@example.com', required: true, value: db.isDemo() ? 'customer@kabaza.mw' : '' }) +
              ui.field('Password', 'password', { type: 'password', placeholder: '••••••••', required: true, value: db.isDemo() ? 'demo1234' : '' }) +
              '<div class="role-choice">' +
                '<label><input type="radio" name="role" value="customer" checked><span>Customer</span></label>' +
                '<label><input type="radio" name="role" value="rider"><span>Rider</span></label>' +
                '<label><input type="radio" name="role" value="admin"><span>Admin</span></label>' +
              '</div>' +
              '<button class="btn btn--primary btn--block" type="submit">Sign in</button>' +
            '</form>' +
            '<button class="link-button login-forgot" id="forgot-password">Forgot your password?</button>' +
            '<div class="login-divider"><span>or</span></div>' +
            '<button class="btn btn--ghost btn--block" id="phone-signin">📱 Sign in with phone number</button>' +
            '<button class="btn btn--primary btn--block" id="create-account">Create an account</button>' +
            '<p class="fineprint">Phone-first sign-up — no Gmail needed. By continuing you agree to the ' +
            '<a href="../terms.html" target="_blank" rel="noopener">Terms</a> and ' +
            '<a href="../privacy.html" target="_blank" rel="noopener">Privacy Policy</a>. ' +
            'Alcohol orders require age verification.</p>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('login-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var values = ui.formValues(e.target);
      var btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        session = await db.signIn(values.email, values.password, values.role);
        location.hash = '#/' + (session.profile.role === 'admin' ? 'admin' : session.profile.role === 'rider' ? 'rider' : 'home');
        router.resolve();
        maybePromptLocation();
        ui.toast('Welcome to KABAZA', 'success');
      } catch (err) {
        ui.toast(err.message || 'Could not sign in', 'error');
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    });

    document.getElementById('forgot-password').addEventListener('click', function () {
      location.hash = '#/recover';
      router.resolve();
    });

    document.getElementById('create-account').addEventListener('click', function () {
      location.hash = '#/register';
      router.resolve();
    });

    document.getElementById('phone-signin').addEventListener('click', function () {
      ui.formModal('Sign in with your phone',
        ui.field('Mobile number', 'phone', { type: 'tel', required: true, placeholder: '0999 123 456' }) +
        ui.field('Password', 'password', { type: 'password', required: true }),
        '<button class="btn btn--ghost" data-close>Cancel</button>' +
        '<button class="btn btn--primary" data-action="signin">Sign in</button>'
      ).then(async function (result) {
        if (!result || result.action !== 'signin') return;
        var phone = KBZ.auth.normalizePhone(result.values.phone);
        if (!phone) { ui.toast('Enter a valid Malawian number', 'error'); return; }
        try {
          var auth = await postApi('/api/auth/login', { phone: phone, password: result.values.password });
          session = await db.setSessionFromTokens(auth.session.accessToken, auth.session.refreshToken);
          location.hash = '#/' + (session.profile.role === 'admin' ? 'admin' : session.profile.role === 'rider' ? 'rider' : 'home');
          router.resolve();
          maybePromptLocation();
          ui.toast('Welcome to KABAZA', 'success');
        } catch (err) {
          ui.toast(err.message || 'Could not sign in', 'error');
        }
      });
    });
  }

  function guard(allowed) {
    if (!session) {
      location.hash = '#/login';
      renderLogin();
      return false;
    }
    if (allowed && allowed.indexOf(role()) === -1) {
      ui.toast('That page is not available for your role', 'error');
      router.go(role() === 'admin' ? 'admin' : role() === 'rider' ? 'rider' : 'home');
      return false;
    }
    return true;
  }

  function registerRoutes() {
    router.add('login', function () {
      renderLogin();
    });
    router.add('register', function () {
      KBZ.auth.register();
    });
    router.add('recover', function () {
      KBZ.auth.recover();
    });

    router.add('home', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('home');
      await KBZ.customer.home(ctx, session);
    });
    router.add('ride', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('ride');
      await KBZ.customer.ride(ctx, session);
    });
    router.add('delivery', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('delivery');
      await KBZ.customer.delivery(ctx, session);
    });
    router.add('shop', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('shop');
      await KBZ.customer.shop(ctx, session);
    });
    router.add('shop/:category', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('shop');
      await KBZ.customer.shop(ctx, session);
    });
    router.add('cart', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('shop');
      await KBZ.customer.cart(ctx, session);
    });
    router.add('checkout', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('shop');
      await KBZ.customer.checkout(ctx, session);
    });
    router.add('orders', async function (ctx) {
      if (!guard(['customer'])) return;
      renderShell('orders');
      await KBZ.customer.orders(ctx, session);
    });
    router.add('orders/:id', async function (ctx) {
      if (!guard(['customer', 'rider', 'admin'])) return;
      renderShell(role() === 'admin' ? 'admin/orders' : role() === 'rider' ? 'rider' : 'orders');
      if (role() === 'admin') await KBZ.admin.orderDetail(ctx, session);
      else await KBZ.customer.orderDetail(ctx, session);
    });
    router.add('profile', async function (ctx) {
      if (!guard()) return;
      renderShell('profile');
      if (role() === 'admin') await KBZ.admin.profile(ctx, session);
      else if (role() === 'rider') await KBZ.rider.profile(ctx, session);
      else await KBZ.customer.profile(ctx, session);
    });

    router.add('rider', async function (ctx) {
      if (!guard(['rider'])) return;
      renderShell('rider');
      await KBZ.rider.jobs(ctx, session);
    });
    router.add('rider/earnings', async function (ctx) {
      if (!guard(['rider'])) return;
      renderShell('rider/earnings');
      await KBZ.rider.earnings(ctx, session);
    });

    router.add('admin', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin');
      await KBZ.admin.dashboard(ctx, session);
    });
    router.add('admin/products', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/products');
      await KBZ.admin.products(ctx, session);
    });
    router.add('admin/vendors', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/vendors');
      await KBZ.admin.vendors(ctx, session);
    });
    router.add('admin/orders', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/orders');
      await KBZ.admin.orders(ctx, session);
    });
    router.add('admin/riders', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/riders');
      await KBZ.admin.riders(ctx, session);
    });
    router.add('admin/users', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/users');
      await KBZ.admin.users(ctx, session);
    });
    router.add('admin/zones', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/zones');
      await KBZ.admin.zones(ctx, session);
    });
    router.add('admin/ledger', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/ledger');
      await KBZ.admin.ledger(ctx, session);
    });
    router.add('admin/settings', async function (ctx) {
      if (!guard(['admin'])) return;
      renderShell('admin/settings');
      await KBZ.admin.settings(ctx, session);
    });

    router.setNotFound(function () {
      router.go(session ? (role() === 'admin' ? 'admin' : role() === 'rider' ? 'rider' : 'home') : 'login');
    });
  }

  async function boot() {
    if (booted) return;
    booted = true;
    document.getElementById('boot').style.display = 'none';
    await db.init();
    session = await db.getSession();
    registerRoutes();

    db.subscribe('orders', function () {
      var p = String(location.hash || '');
      if (p.indexOf('orders') > -1 || p.indexOf('rider') > -1 || p.indexOf('admin') > -1) {
        router.resolve();
      }
    });

    KBZ.payments.resumePending().catch(function (e) {
      console.warn('Pending payment check skipped', e);
    });

    // Trigger Android's runtime location dialog once in the APK, after login.
    // A refusal is not fatal: the app still works, but maps cannot pinpoint.
    maybePromptLocation();

    if (!session) {
      location.hash = '#/login';
      renderLogin();
    } else {
      if (!location.hash || location.hash === '#/') {
        location.hash = '#/' + (session.profile.role === 'admin' ? 'admin' : session.profile.role === 'rider' ? 'rider' : 'home');
      }
      router.resolve();
    }
  }

  KBZ.app = {
    boot: boot,
    session: function () { return session; },
    setSession: function (s) { session = s; },
    role: role,
    renderShell: renderShell
  };

  window.addEventListener('DOMContentLoaded', boot);
})();
