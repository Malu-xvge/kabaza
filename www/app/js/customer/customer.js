// Customer side: home, rides, deliveries, shop, cart, checkout, tracking.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var ui = KBZ.ui;
  var db = KBZ.db;
  var router = KBZ.router;
  var CART_KEY = 'kbz_cart';
  var AGE_KEY = 'kbz_age_verified';

  function main() { return document.getElementById('main'); }

  function cart() {
    try {
      var v = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function saveCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    updateCartBadge();
  }

  function cartCount() {
    return cart().reduce(function (n, i) { return n + Number(i.qty || 0); }, 0);
  }

  function updateCartBadge() {
    var badge = document.getElementById('cart-badge');
    if (!badge) return;
    var n = cartCount();
    badge.textContent = n;
    badge.style.display = n ? 'inline-flex' : 'none';
  }

  function cartTotals() {
    var items = cart();
    var subtotal = items.reduce(function (n, i) { return n + Number(i.price) * Number(i.qty); }, 0);
    var settings = null;
    return db.getSettings().then(function (s) {
      settings = s || {};
      var fee = subtotal >= Number(settings.free_delivery_over || 25000) ? 0 : Number(settings.delivery_fee || 700);
      return { items: items, subtotal: subtotal, fee: fee, total: subtotal + fee, settings: settings };
    });
  }

  function ageVerified() {
    return sessionStorage.getItem(AGE_KEY) === '1';
  }

  function verifyAge() {
    if (ageVerified()) return Promise.resolve(true);
    return ui.modal('Age verification',
      '<div class="notice notice--warn">Alcohol and tobacco products are only sold to people aged 18 and over. A rider may ask for ID on delivery.</div>' +
      '<label class="check-row"><input type="checkbox" id="age-confirm"> I confirm that I am 18 years or older.</label>',
      '<button class="btn btn--ghost" data-close>Cancel</button>' +
      '<button class="btn btn--primary" data-action="confirm">I am 18+</button>'
    ).then(function (action) {
      if (action !== 'confirm') return false;
      var checked = document.getElementById('age-confirm');
      // checkbox is removed with modal on resolve, so read before close via closure hack below
      return Boolean(window.__kbzAgeChecked);
    });
  }

  // Patch verifyAge to read the checkbox before the modal closes.
  verifyAge = function () {
    if (ageVerified()) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var overlay = ui.el('<div class="modal-overlay"><div class="modal" role="dialog">' +
        '<div class="modal__head"><h3>Age verification</h3><button class="icon-btn" data-no>&times;</button></div>' +
        '<div class="modal__body"><div class="notice notice--warn">Alcohol is only sold to people aged 18 and over. Your rider may ask for ID on delivery.</div>' +
        '<label class="check-row"><input type="checkbox" id="age-confirm"> I confirm that I am 18 years or older.</label></div>' +
        '<div class="modal__foot"><button class="btn btn--ghost" data-no>Cancel</button>' +
        '<button class="btn btn--primary" data-yes>I am 18+</button></div></div></div>');
      function close(result) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(result);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-no]')) close(false);
        if (e.target.closest('[data-yes]')) {
          var checked = ui.qs('#age-confirm', overlay).checked;
          if (!checked) { ui.toast('Please confirm your age', 'error'); return; }
          sessionStorage.setItem(AGE_KEY, '1');
          close(true);
        }
      });
      document.body.appendChild(overlay);
    });
  };

  async function addToCart(product) {
    if (product.age_restricted && !(await verifyAge())) return;
    var items = cart();
    var existing = items.filter(function (i) { return i.product_id === product.id; })[0];
    if (existing) existing.qty += 1;
    else items.push({
      product_id: product.id, name: product.name, price: Number(product.price),
      qty: 1, image_url: product.image_url, source: product.source,
      source_label: product.source_label, age_restricted: product.age_restricted
    });
    saveCart(items);
    ui.toast(product.name + ' added to cart', 'success');
  }

  function productCard(p) {
    return '<article class="product-card">' +
      '<div class="product-card__img">' +
        (p.image_url ? '<img src="' + ui.esc(p.image_url) + '" alt="">' :
          '<span class="product-card__emoji">' +
            (p.name.toLowerCase().indexOf('chibuku') > -1 ? '🍺' :
             p.name.toLowerCase().indexOf('chicken') > -1 ? '🍗' :
             p.name.toLowerCase().indexOf('maize') > -1 ? '🌽' :
             p.name.toLowerCase().indexOf('water') > -1 ? '💧' :
             p.name.toLowerCase().indexOf('bread') > -1 ? '🍞' : '🛍') + '</span>') +
        (p.age_restricted ? ui.ageBadge() : '') +
        (Number(p.stock_qty) === 0 && p.source === 'kabaza' ? '<span class="out-badge">Out of stock</span>' : '') +
      '</div>' +
      '<div class="product-card__body">' +
        '<h4>' + ui.esc(p.name) + '</h4>' +
        '<div class="product-card__meta">' + ui.sourceBadge(p) + '</div>' +
        '<div class="product-card__foot">' +
          '<strong>' + ui.money(p.price) + '</strong>' +
          '<button class="btn btn--small btn--primary" data-add="' + ui.esc(p.id) + '">Add +</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function activeOrderCard(order) {
    return '<div class="active-order" onclick="location.hash=\'#/orders/' + ui.esc(order.id) + '\'">' +
      '<div class="active-order__top"><span class="live-dot"></span><strong>' +
        (order.kind === 'ride' ? 'Ride in progress' : order.kind === 'delivery' ? 'Delivery in progress' : 'Order in progress') +
      '</strong>' + ui.statusPill(order.status) + '</div>' +
      '<div class="active-order__route">' +
        '<div><span class="dot dot--green"></span>' + ui.esc(order.pickup_address || 'Pickup') + '</div>' +
        '<div><span class="dot dot--lime"></span>' + ui.esc(order.dropoff_address || 'Destination') + '</div>' +
      '</div>' +
      '<div class="active-order__foot"><span>Tap to track live</span><span>→</span></div>' +
    '</div>';
  }

  // ------------------------------------------------------------------- home
  async function home(ctx, session) {
    var orders = await db.listOrders({ customerId: session.user.id });
    var active = orders.filter(function (o) {
      return ['pending', 'accepted', 'arriving', 'picked_up', 'in_transit'].indexOf(o.status) > -1;
    })[0];
    var zones = await db.listZones();
    var settings = await db.getSettings();
    var name = (session.profile.full_name || 'there').split(' ')[0];

    main().innerHTML =
      '<div class="page page--home">' +
        '<div class="greeting">' +
          '<div><p class="eyebrow">Welcome to KABAZA</p><h1>Hey ' + ui.esc(name) + ' 👋</h1>' +
          '<p class="muted">Where are we taking you today?</p></div>' +
          '<div class="greeting__city">📍 ' + ui.esc(session.profile.city || 'Lilongwe') + '</div>' +
        '</div>' +

        (active ? activeOrderCard(active) : '') +

        '<div class="service-grid">' +
          '<a class="service-card service-card--ride" href="#/ride"><span class="service-card__icon">🏍</span>' +
            '<strong>Book a ride</strong><span>Fast bike taxis across town</span><span class="service-card__arrow">→</span></a>' +
          '<a class="service-card service-card--delivery" href="#/delivery"><span class="service-card__icon">📦</span>' +
            '<strong>Send a parcel</strong><span>Deliveries, errands and pickups</span><span class="service-card__arrow">→</span></a>' +
          '<a class="service-card service-card--food" href="#/shop/food"><span class="service-card__icon">🍛</span>' +
            '<strong>Food</strong><span>Meals delivered hot</span><span class="service-card__arrow">→</span></a>' +
          '<a class="service-card service-card--grocery" href="#/shop/grocery"><span class="service-card__icon">🛒</span>' +
            '<strong>Groceries</strong><span>Shop from home</span><span class="service-card__arrow">→</span></a>' +
          '<a class="service-card service-card--alcohol" href="#/shop/alcohol"><span class="service-card__icon">🍺</span>' +
            '<strong>Alcohol <span class="age-badge">18+</span></strong><span>Drinks to your door</span><span class="service-card__arrow">→</span></a>' +
          '<a class="service-card service-card--shop" href="#/shop"><span class="service-card__icon">🛍</span>' +
            '<strong>Shop all</strong><span>Everything in one place</span><span class="service-card__arrow">→</span></a>' +
        '</div>' +

        ui.section('Popular right now', 'Handpicked from Kabaza and partner shops',
          '<a class="link-arrow" href="#/shop">See all →</a>') +
        '<div class="product-row" id="popular-products">' + ui.loading('Loading products…') + '</div>' +

        '<div class="info-strip">' +
          '<div><span>🛡</span><strong>Safe rides</strong><small>Verified riders</small></div>' +
          '<div><span>⚡</span><strong>Fast delivery</strong><small>From 20 minutes</small></div>' +
          '<div><span>💳</span><strong>Mobile money</strong><small>Pay with PayChangu</small></div>' +
        '</div>' +

        (settings.alcohol_notice ? '<p class="fineprint home-notice">' + ui.esc(settings.alcohol_notice) + '</p>' : '') +
        '<p class="fineprint">' + ui.esc((settings.pricing_note || '') + ' · ' + (zones.length ? zones.length + ' zones available' : '')) + '</p>' +
      '</div>';

    var products = await db.listProducts({ activeOnly: true });
    var el = document.getElementById('popular-products');
    if (el) el.innerHTML = products.slice(0, 4).map(productCard).join('') || ui.empty('No products yet', 'Admin has not stocked the catalog.');
    wireProducts();
  }

  function wireProducts() {
    ui.on(main(), 'click', '[data-add]', async function (e, btn) {
      var p = await db.getProduct(btn.getAttribute('data-add'));
      if (p) await addToCart(p);
    });
  }

  // ----------------------------------------------- ride & delivery ordering
  function orderForm(kind, zones) {
    var isRide = kind === 'ride';
    return '<div class="page page--book">' +
      '<div class="page-head"><a href="#/home" class="back-link">← Back</a>' +
        '<h1>' + (isRide ? 'Book a ride' : 'Send a delivery') + '</h1>' +
        '<p class="muted">' + (isRide ? 'A boda rider will pick you up in minutes.' : 'Tell us what to pick up and where to take it.') + '</p></div>' +
      '<form id="book-form" class="book-form">' +
        ui.card(
          '<div class="route-inputs">' +
            '<div class="route-line"><span class="dot dot--green"></span><div class="route-inputs__line"></div><span class="dot dot--lime"></span></div>' +
            '<div class="route-inputs__fields">' +
              ui.field('Pickup location', 'pickup_address', { placeholder: 'e.g. City Centre, Lilongwe', required: true }) +
              ui.field('Destination', 'dropoff_address', { placeholder: 'e.g. Kanengo', required: true }) +
            '</div>' +
          '</div>' +
          ui.field('Your phone number', 'phone', { placeholder: '+265 999 000 000', required: true }) +
          (!isRide ?
            ui.field('What are you sending?', 'notes', { type: 'textarea', placeholder: 'e.g. Documents, parcel, medicine' }) +
            ui.field('Parcel size', 'parcel_size', { type: 'select', options: ['Small', 'Medium', 'Large'] }) : '') +
          '<div class="zone-row">' +
            ui.field('Pickup zone', 'pickup_zone', { type: 'select', options: zones.map(function (z) { return { value: z.id, label: z.name }; }) }) +
            ui.field('Destination zone', 'dropoff_zone', { type: 'select', options: zones.map(function (z) { return { value: z.id, label: z.name }; }) }) +
          '</div>' +
          ui.field('Estimated distance (km)', 'distance_km', { type: 'number', step: '0.5', min: '0.5', value: '3' })
        ) +
        '<div class="fare-card" id="fare-card">' +
          '<div><span>Estimated fare</span><strong id="fare-value">MK 1,700</strong></div>' +
          '<small class="muted">Final fare is confirmed by your rider.</small>' +
        '</div>' +
        '<button class="btn btn--primary btn--block btn--large" type="submit">' +
          (isRide ? 'Request ride' : 'Request delivery') + '</button>' +
        '<p class="fineprint">You can pay the rider in cash or with mobile money after the ' +
          (isRide ? 'ride' : 'delivery') + ' is confirmed.</p>' +
      '</form>' +
    '</div>';
  }

  function fareFor(zones, fromId, toId, distance) {
    var from = zones.filter(function (z) { return z.id === fromId; })[0];
    var to = zones.filter(function (z) { return z.id === toId; })[0];
    var base = from ? Number(from.base_fare) : 800;
    var perKm = to ? Number(to.per_km) : 300;
    return Math.round(base + perKm * Math.max(0.5, Number(distance) || 1));
  }

  async function wireBooking(kind, zones, session) {
    var form = document.getElementById('book-form');
    if (!form) return;
    var values = ui.formValues(form);

    function updateFare() {
      var v = ui.formValues(form);
      var fare = fareFor(zones, v.pickup_zone, v.dropoff_zone, v.distance_km);
      var el = document.getElementById('fare-value');
      if (el) el.textContent = ui.money(fare);
    }

    form.addEventListener('input', updateFare);
    form.addEventListener('change', updateFare);
    updateFare();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = ui.formValues(form);
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Finding a rider…';
      try {
        var fare = fareFor(zones, v.pickup_zone, v.dropoff_zone, v.distance_km);
        var from = zones.filter(function (z) { return z.id === v.pickup_zone; })[0] || {};
        var to = zones.filter(function (z) { return z.id === v.dropoff_zone; })[0] || {};
        var order = await db.createOrder({
          customer_id: session.user.id,
          kind: kind,
          status: 'pending',
          pickup_address: v.pickup_address,
          dropoff_address: v.dropoff_address,
          pickup_lat: from.center_lat || null,
          pickup_lng: from.center_lng || null,
          dropoff_lat: to.center_lat || null,
          dropoff_lng: to.center_lng || null,
          distance_km: Number(v.distance_km) || 1,
          subtotal: fare,
          delivery_fee: 0,
          total: fare,
          payment_method: 'cash',
          payment_status: 'unpaid',
          notes: [v.phone && ('Phone: ' + v.phone), v.parcel_size && ('Size: ' + v.parcel_size), v.notes].filter(Boolean).join(' · ')
        });
        await db.appendLedger({
          entity_type: 'order', entity_id: order.id, event_type: 'order_placed',
          payload: { kind: kind, total: fare, pickup: v.pickup_address },
          actor_id: session.user.id
        });
        ui.toast(kind === 'ride' ? 'Ride requested' : 'Delivery requested', 'success');
        router.go('orders/' + order.id);
      } catch (err) {
        ui.toast(err.message || 'Could not place request', 'error');
        btn.disabled = false;
        btn.textContent = kind === 'ride' ? 'Request ride' : 'Request delivery';
      }
    });
  }

  async function ride(ctx, session) {
    var zones = await db.listZones();
    main().innerHTML = orderForm('ride', zones);
    await wireBooking('ride', zones, session);
  }

  async function delivery(ctx, session) {
    var zones = await db.listZones();
    main().innerHTML = orderForm('delivery', zones);
    await wireBooking('delivery', zones, session);
  }

  // ------------------------------------------------------------------- shop
  async function shop(ctx, session) {
    var categories = await db.listCategories();
    var slug = ctx.params.category;
    var activeCat = categories.filter(function (c) { return c.slug === slug; })[0];
    var products = await db.listProducts({ categorySlug: slug, activeOnly: true });
    if (!slug) products = await db.listProducts({ activeOnly: true });

    main().innerHTML =
      '<div class="page page--shop">' +
        '<div class="shop-head">' +
          '<div><p class="eyebrow">KABAZA store</p><h1>' + (activeCat ? activeCat.icon + ' ' + ui.esc(activeCat.name) : 'Shop everything') + '</h1>' +
          '<p class="muted">In-stock items and partner products, clearly labelled.</p></div>' +
          '<a href="#/cart" class="cart-link">🛒 Cart <span class="cart-badge" id="cart-badge">' + cartCount() + '</span></a>' +
        '</div>' +
        '<div class="category-chips">' +
          '<a href="#/shop" class="chip ' + (!slug ? 'is-active' : '') + '">All</a>' +
          categories.map(function (c) {
            return '<a href="#/shop/' + ui.esc(c.slug) + '" class="chip ' + (slug === c.slug ? 'is-active' : '') + '">' +
              c.icon + ' ' + ui.esc(c.name) + '</a>';
          }).join('') +
        '</div>' +
        '<div class="search-bar"><input class="input" id="product-search" placeholder="Search products…" value="' + ui.esc(ctx.query.q || '') + '">' +
          '<button class="btn btn--primary" id="search-btn">Search</button></div>' +
        '<div class="legend">' +
          '<span>' + ui.sourceBadge({ source: 'kabaza' }) + '</span>' +
          '<span>' + ui.sourceBadge({ source: 'partner' }) + '</span>' +
          '<span class="age-badge">18+</span><span class="muted">Age restricted</span>' +
        '</div>' +
        '<div class="product-grid" id="product-grid">' +
          (products.length ? products.map(productCard).join('') : ui.empty('Nothing here yet', 'Check back soon or browse another category.')) +
        '</div>' +
      '</div>';

    wireProducts();
    updateCartBadge();

    function runSearch() {
      var q = ui.qs('#product-search').value.trim();
      if (!q) { router.go('shop' + (slug ? '/' + slug : '')); return; }
      db.listProducts({ q: q }).then(function (results) {
        ui.qs('#product-grid').innerHTML = results.length ? results.map(productCard).join('') : ui.empty('No matches', 'Try a different search.');
        wireProducts();
      });
    }
    var searchBtn = document.getElementById('search-btn');
    if (searchBtn) searchBtn.addEventListener('click', runSearch);
    var searchInput = document.getElementById('product-search');
    if (searchInput) searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') runSearch();
    });
  }

  // ------------------------------------------------------------------- cart
  async function cartPage(ctx, session) {
    var totals = await cartTotals();
    main().innerHTML =
      '<div class="page page--cart">' +
        '<div class="page-head"><a href="#/shop" class="back-link">← Continue shopping</a>' +
          '<h1>Your cart</h1><p class="muted">' + cartCount() + ' items</p></div>' +
        (totals.items.length ?
          '<div class="cart-layout">' +
            '<div class="cart-items">' + totals.items.map(function (item, idx) {
              return '<div class="cart-item">' +
                '<div class="cart-item__img">' + (item.image_url ? '<img src="' + ui.esc(item.image_url) + '">' : '🛍') + '</div>' +
                '<div class="cart-item__info"><strong>' + ui.esc(item.name) + '</strong>' +
                  ui.sourceBadge(item) + (item.age_restricted ? ui.ageBadge() : '') +
                  '<span class="muted">' + ui.money(item.price) + ' each</span></div>' +
                '<div class="cart-item__controls">' +
                  '<button class="qty-btn" data-dec="' + idx + '">−</button>' +
                  '<span>' + item.qty + '</span>' +
                  '<button class="qty-btn" data-inc="' + idx + '">+</button>' +
                '</div>' +
                '<strong class="cart-item__price">' + ui.money(item.price * item.qty) + '</strong>' +
                '<button class="icon-btn cart-item__remove" data-remove="' + idx + '">×</button>' +
              '</div>';
            }).join('') + '</div>' +
            '<div class="summary-card">' +
              '<h3>Order summary</h3>' +
              '<div class="summary-row"><span>Subtotal</span><strong>' + ui.money(totals.subtotal) + '</strong></div>' +
              '<div class="summary-row"><span>Delivery</span><strong>' + (totals.fee ? ui.money(totals.fee) : 'Free') + '</strong></div>' +
              '<div class="summary-row summary-row--total"><span>Total</span><strong>' + ui.money(totals.total) + '</strong></div>' +
              (totals.subtotal < Number(totals.settings.free_delivery_over || 25000) ?
                '<p class="fineprint">Add ' + ui.money(Number(totals.settings.free_delivery_over || 25000) - totals.subtotal) + ' more for free delivery.</p>' : '') +
              '<a href="#/checkout" class="btn btn--primary btn--block btn--large">Checkout</a>' +
              '<button class="btn btn--ghost btn--block" id="clear-cart">Clear cart</button>' +
            '</div>' +
          '</div>' :
          ui.empty('Your cart is empty', 'Add something from the shop to get started.', '<a class="btn btn--primary" href="#/shop">Browse shop</a>')) +
      '</div>';

    ui.on(main(), 'click', '[data-inc]', function (e, btn) {
      var items = cart(); var i = Number(btn.getAttribute('data-inc'));
      items[i].qty += 1; saveCart(items); cartPage(ctx, session);
    });
    ui.on(main(), 'click', '[data-dec]', function (e, btn) {
      var items = cart(); var i = Number(btn.getAttribute('data-dec'));
      items[i].qty -= 1;
      if (items[i].qty <= 0) items.splice(i, 1);
      saveCart(items); cartPage(ctx, session);
    });
    ui.on(main(), 'click', '[data-remove]', function (e, btn) {
      var items = cart(); items.splice(Number(btn.getAttribute('data-remove')), 1);
      saveCart(items); cartPage(ctx, session);
    });
    var clear = document.getElementById('clear-cart');
    if (clear) clear.addEventListener('click', async function () {
      if (await ui.confirm('Clear cart?', 'Remove everything from your cart?', 'Clear')) {
        saveCart([]); cartPage(ctx, session);
      }
    });
  }

  // --------------------------------------------------------------- checkout
  async function checkout(ctx, session) {
    var totals = await cartTotals();
    if (!totals.items.length) { router.go('cart'); return; }
    var hasAlcohol = totals.items.some(function (i) { return i.age_restricted; });

    main().innerHTML =
      '<div class="page page--checkout">' +
        '<div class="page-head"><a href="#/cart" class="back-link">← Back to cart</a>' +
          '<h1>Checkout</h1><p class="muted">Almost there.</p></div>' +
        '<form id="checkout-form" class="checkout-layout">' +
          '<div>' +
            ui.card(
              '<h3>Delivery details</h3>' +
              ui.field('Delivery address', 'address', { placeholder: 'e.g. Area 25, Lilongwe', required: true, value: session.profile.city || '' }) +
              ui.field('Phone number', 'phone', { placeholder: '+265 999 000 000', required: true, value: session.profile.phone || '' }) +
              ui.field('Delivery note', 'note', { type: 'textarea', placeholder: 'Landmark, instructions…' })
            ) +
            (hasAlcohol ? '<div class="notice notice--warn">This order contains alcohol. You must be 18 or older. ' +
              (ageVerified() ? '✓ Age confirmed.' : '<button type="button" class="link-button" id="verify-age">Verify my age</button>') + '</div>' : '') +
            ui.card(
              '<h3>Payment</h3>' +
              '<label class="radio-row"><input type="radio" name="payment_method" value="paychangu" checked>' +
                '<span><strong>Mobile money</strong><small>Pay securely with PayChangu (TNM Mpamba, Airtel Money)</small></span></label>' +
              '<label class="radio-row"><input type="radio" name="payment_method" value="cash">' +
                '<span><strong>Pay on delivery</strong><small>Pay the rider in cash when your order arrives</small></span></label>'
            ) +
          '</div>' +
          '<div class="summary-card">' +
            '<h3>Your order</h3>' +
            totals.items.map(function (i) {
              return '<div class="summary-row"><span>' + ui.esc(i.qty) + '× ' + ui.esc(i.name) + '</span><strong>' + ui.money(i.price * i.qty) + '</strong></div>';
            }).join('') +
            '<div class="summary-row"><span>Delivery</span><strong>' + (totals.fee ? ui.money(totals.fee) : 'Free') + '</strong></div>' +
            '<div class="summary-row summary-row--total"><span>Total</span><strong>' + ui.money(totals.total) + '</strong></div>' +
            '<button class="btn btn--primary btn--block btn--large" type="submit">Place order</button>' +
            '<p class="fineprint">By placing this order you agree to the KABAZA terms.' +
              (hasAlcohol ? ' Alcohol orders require age verification.' : '') + '</p>' +
          '</div>' +
        '</form>' +
      '</div>';

    var verifyBtn = document.getElementById('verify-age');
    if (verifyBtn) verifyBtn.addEventListener('click', async function () {
      var ok = await verifyAge();
      if (ok) checkout(ctx, session);
    });

    document.getElementById('checkout-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (hasAlcohol && !ageVerified()) {
        var ok = await verifyAge();
        if (!ok) return;
      }
      var v = ui.formValues(e.target);
      var btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Placing order…';
      try {
        var items = totals.items;
        var order = await db.createOrder({
          customer_id: session.user.id,
          kind: 'shop',
          status: 'pending',
          pickup_address: 'KabaZa store',
          dropoff_address: v.address,
          notes: [v.phone && ('Phone: ' + v.phone), v.note].filter(Boolean).join(' · '),
          subtotal: totals.subtotal,
          delivery_fee: totals.fee,
          total: totals.total,
          payment_method: v.payment_method,
          payment_status: 'unpaid',
          age_verified: hasAlcohol,
          items: items.map(function (i) {
            return {
              product_id: i.product_id, name_snapshot: i.name, price: i.price,
              qty: i.qty, source: i.source, source_label: i.source_label
            };
          })
        });
        await db.appendLedger({
          entity_type: 'order', entity_id: order.id, event_type: 'order_placed',
          payload: { kind: 'shop', total: totals.total, items: items.length, age_verified: hasAlcohol },
          actor_id: session.user.id
        });
        saveCart([]);

        if (v.payment_method === 'paychangu') {
          router.go('orders/' + order.id);
          ui.toast('Order placed — complete payment', 'success');
          setTimeout(function () { payNow(order, session); }, 350);
        } else {
          ui.toast('Order placed. Pay on delivery.', 'success');
          router.go('orders/' + order.id);
        }
      } catch (err) {
        ui.toast(err.message || 'Could not place order', 'error');
        btn.disabled = false;
        btn.textContent = 'Place order';
      }
    });
  }

  async function payNow(order, session) {
    var btn = document.getElementById('pay-now');
    if (btn) btn.disabled = true;
    try {
      var result = await KBZ.payments.payForOrder(order, function (stage) {
        var el = document.getElementById('pay-stage');
        if (el) el.textContent = KBZ.payments.stageText(stage);
      });
      if (result && result.status === 'success') {
        ui.toast('Payment confirmed', 'success');
        router.resolve();
      }
    } catch (err) {
      ui.toast(KBZ.payments.errorText(err), 'error');
      if (btn) btn.disabled = false;
      var stage = document.getElementById('pay-stage');
      if (stage) stage.textContent = '';
    }
  }

  // ----------------------------------------------------------------- orders
  async function orders(ctx, session) {
    var list = await db.listOrders({ customerId: session.user.id });
    main().innerHTML =
      '<div class="page page--orders">' +
        '<div class="page-head"><h1>Your orders</h1><p class="muted">Rides, deliveries and shop orders in one place.</p></div>' +
        '<div class="filter-chips">' +
          '<button class="chip is-active" data-filter="all">All</button>' +
          '<button class="chip" data-filter="active">Active</button>' +
          '<button class="chip" data-filter="completed">Completed</button>' +
          '<button class="chip" data-filter="shop">Shop</button>' +
        '</div>' +
        '<div id="orders-list">' + (list.length ? list.map(orderRow).join('') :
          ui.empty('No orders yet', 'Book a ride or shop to see your orders here.', '<a class="btn btn--primary" href="#/home">Get started</a>')) + '</div>' +
      '</div>';

    ui.on(main(), 'click', '[data-filter]', function (e, btn) {
      ui.qsa('[data-filter]', main()).forEach(function (b) { b.classList.remove('is-active'); });
      btn.classList.add('is-active');
      var f = btn.getAttribute('data-filter');
      var filtered = list.filter(function (o) {
        if (f === 'all') return true;
        if (f === 'active') return ['pending', 'accepted', 'arriving', 'picked_up', 'in_transit'].indexOf(o.status) > -1;
        if (f === 'completed') return o.status === 'completed';
        return o.kind === f;
      });
      document.getElementById('orders-list').innerHTML = filtered.length ? filtered.map(orderRow).join('') : ui.empty('Nothing here', 'Try another filter.');
    });
  }

  function orderRow(o) {
    var icon = o.kind === 'ride' ? '🏍' : o.kind === 'delivery' ? '📦' : '🛍';
    return '<a class="order-row" href="#/orders/' + ui.esc(o.id) + '">' +
      '<span class="order-row__icon">' + icon + '</span>' +
      '<span class="order-row__main"><strong>' + ui.esc(o.kind === 'shop' ? (o.age_verified ? 'Shop order · 18+' : 'Shop order') : o.kind.charAt(0).toUpperCase() + o.kind.slice(1)) + '</strong>' +
        '<small>' + ui.esc(o.dropoff_address || '—') + '</small>' +
        '<small class="muted">' + ui.date(o.created_at) + '</small></span>' +
      '<span class="order-row__right">' + ui.statusPill(o.status) + '<strong>' + ui.money(o.total) + '</strong></span>' +
    '</a>';
  }

  async function orderDetail(ctx, session) {
    var order = await db.getOrder(ctx.params.id);
    if (!order) { main().innerHTML = ui.empty('Order not found', '', '<a class="btn btn--primary" href="#/orders">Back to orders</a>'); return; }
    var events = await db.listOrderEvents(order.id);
    var items = await db.listOrderItems(order.id);
    var rider = order.rider_id ? await db.getRider(order.rider_id) : null;
    var ledger = await db.listLedger({ entityId: order.id });

    main().innerHTML =
      '<div class="page page--order-detail">' +
        '<div class="page-head"><a href="#/orders" class="back-link">← All orders</a>' +
          '<h1>' + (order.kind === 'ride' ? 'Ride' : order.kind === 'delivery' ? 'Delivery' : 'Order') + ' details</h1>' +
          '<p class="muted">' + ui.date(order.created_at) + ' · ' + ui.esc(order.id) + '</p></div>' +
        '<div class="detail-layout">' +
          '<div>' +
            ui.card(
              '<div class="detail-status"><h2>' + ui.statusPill(order.status) + '</h2>' +
                '<span class="muted">' + ui.esc(order.payment_status) + '</span></div>' +
              '<div class="route-detail">' +
                '<div><span class="dot dot--green"></span><div><small>Pickup</small><strong>' + ui.esc(order.pickup_address) + '</strong></div></div>' +
                '<div><span class="dot dot--lime"></span><div><small>Destination</small><strong>' + ui.esc(order.dropoff_address) + '</strong></div></div>' +
              '</div>' +
              (order.notes ? '<p class="muted">' + ui.esc(order.notes) + '</p>' : '') +
              (rider ? '<div class="rider-card">' + ui.avatar('Rider', '', 44) +
                '<div><strong>Your rider</strong><small>' + ui.esc(rider.vehicle_type || 'Boda') + ' · ' + ui.esc(rider.plate_number || '') + '</small></div>' +
                '<span class="rating">★ ' + Number(rider.rating || 5).toFixed(1) + '</span></div>' : '') +
              (order.payment_status !== 'paid' && order.payment_method === 'paychangu' ?
                '<div class="pay-block"><button class="btn btn--primary btn--block btn--large" id="pay-now">Pay ' + ui.money(order.total) + ' with mobile money</button>' +
                '<p class="fineprint" id="pay-stage"></p></div>' :
                '<div class="notice notice--success">' + (order.payment_status === 'paid' ? '✓ Payment confirmed' : 'Pay on delivery') + '</div>')
            ) +
            (items.length ? ui.card('<h3>Items</h3>' + items.map(function (i) {
              return '<div class="summary-row"><span>' + ui.esc(i.qty) + '× ' + ui.esc(i.name_snapshot) + '<br>' + ui.sourceBadge(i) + '</span>' +
                '<strong>' + ui.money(i.price * i.qty) + '</strong></div>';
            }).join('') +
              '<div class="summary-row summary-row--total"><span>Total</span><strong>' + ui.money(order.total) + '</strong></div>') : '') +
            ui.card('<h3>Provenance <span class="tag">supply chain</span></h3>' +
              (ledger.length ? '<div class="timeline timeline--compact">' + ledger.map(function (e) {
                return '<div class="timeline__item"><span class="timeline__dot"></span>' +
                  '<div><strong>' + ui.esc(e.event_type.replace(/_/g, ' ')) + '</strong>' +
                  '<small>' + ui.date(e.created_at) + '</small>' +
                  '<code>' + ui.esc(String(e.hash || '').slice(0, 16)) + '…</code>' +
                  (e.anchored_tx ? '<small class="success-text">Anchored: ' + ui.esc(e.anchored_tx.slice(0, 12)) + '…</small>' : '<small class="muted">Not yet anchored on-chain</small>') +
                  '</div></div>';
              }).join('') + '</div>' : '<p class="muted">No ledger entries for this order yet.</p>')) +
          '<div>' +
            ui.card('<h3>Order total</h3>' +
              '<div class="summary-row"><span>Subtotal</span><strong>' + ui.money(order.subtotal) + '</strong></div>' +
              '<div class="summary-row"><span>Delivery</span><strong>' + ui.money(order.delivery_fee) + '</strong></div>' +
              '<div class="summary-row summary-row--total"><span>Total</span><strong>' + ui.money(order.total) + '</strong></div>' +
              '<div class="summary-row"><span>Payment</span><span>' + ui.esc(order.payment_method === 'cash' ? 'Pay on delivery' : 'PayChangu') + '</span></div>') +
            ui.card('<h3>Progress</h3><div class="timeline">' +
              events.map(function (ev) {
                return '<div class="timeline__item"><span class="timeline__dot"></span>' +
                  '<div><strong>' + ui.esc(ev.status.replace(/_/g, ' ')) + '</strong>' +
                  (ev.note ? '<p class="muted">' + ui.esc(ev.note) + '</p>' : '') +
                  '<small>' + ui.date(ev.created_at) + '</small></div></div>';
              }).join('') + '</div>') +
          '</div>' +
        '</div>' +
      '</div>';

    var payBtn = document.getElementById('pay-now');
    if (payBtn) payBtn.addEventListener('click', function () { payNow(order, session); });
  }

  // ---------------------------------------------------------------- profile
  async function profile(ctx, session) {
    var p = session.profile;
    main().innerHTML =
      '<div class="page page--profile">' +
        '<div class="page-head"><h1>Your profile</h1></div>' +
        ui.card('<div class="profile-head">' + ui.avatar(p.full_name, p.avatar_url, 72) +
          '<div><h2>' + ui.esc(p.full_name) + '</h2><p class="muted">' + ui.esc(p.email || p.phone || '') + '</p>' +
          '<span class="pill pill--customer">' + ui.esc(p.role) + '</span></div></div>') +
        ui.card('<h3>Details</h3>' +
          '<form id="profile-form" class="form-grid">' +
            ui.field('Full name', 'full_name', { value: p.full_name, required: true }) +
            ui.field('Phone', 'phone', { value: p.phone }) +
            ui.field('City', 'city', { value: p.city }) +
            '<div class="form-actions"><button class="btn btn--primary" type="submit">Save changes</button></div>' +
          '</form>') +
        ui.card('<h3>Safety & preferences</h3>' +
          '<div class="pref-row"><span>🛡</span><div><strong>Verified rider network</strong><small>All KABAZA riders are vetted.</small></div></div>' +
          '<div class="pref-row"><span>🍺</span><div><strong>Alcohol age checks</strong><small>' + (ageVerified() ? 'Age verified on this device.' : 'You will be asked to verify when ordering alcohol.') + '</small></div></div>' +
          '<div class="pref-row"><span>⛓</span><div><strong>Provenance ledger</strong><small>Every order is recorded in an audit trail, ready for future on-chain anchoring.</small></div></div>') +
      '</div>';

    document.getElementById('profile-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var values = ui.formValues(e.target);
      try {
        var updated = await db.updateProfile(p.id, values);
        KBZ.app.setSession(Object.assign({}, session, { profile: updated }));
        ui.toast('Profile updated', 'success');
      } catch (err) {
        ui.toast(err.message || 'Could not save', 'error');
      }
    });
  }

  KBZ.customer = {
    home: home, ride: ride, delivery: delivery, shop: shop,
    cart: cartPage, checkout: checkout, orders: orders,
    orderDetail: orderDetail, profile: profile,
    cartCount: cartCount, updateCartBadge: updateCartBadge, addToCart: addToCart
  };
})();
