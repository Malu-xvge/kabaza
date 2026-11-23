// Rider side: go online, receive jobs, accept, navigate, update status, earnings.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var ui = KBZ.ui;
  var db = KBZ.db;
  var router = KBZ.router;
  var watchId = null;
  var refreshTimer = null;
  var subscribed = false;

  function ensureSubscription() {
    if (subscribed) return;
    subscribed = true;
    db.subscribe('orders', function () {
      var s = KBZ.app.session();
      if (s && String(location.hash).indexOf('rider') > -1) jobs({}, s);
    });
  }

  function main() { return document.getElementById('main'); }

  function nextStatus(status) {
    return ({
      accepted: 'arriving', arriving: 'picked_up', picked_up: 'in_transit', in_transit: 'completed'
    })[status] || null;
  }

  function nextLabel(status) {
    return ({
      accepted: 'I have arrived', arriving: 'Picked up', picked_up: 'On the way', in_transit: 'Mark delivered'
    })[status] || '';
  }

  async function startLocationWatch(rider) {
    if (!navigator.geolocation || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(async function (pos) {
      try {
        await db.updateRider(rider.id, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading || 0
        });
      } catch (e) {}
    }, function () {
      // Location denied — rider can still work, dispatch just won't be live.
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }

  function stopLocationWatch() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  async function jobs(ctx, session) {
    var rider = await db.getRiderForProfile(session.user.id);
    if (!rider) {
      main().innerHTML = ui.empty('Rider profile not set up', 'Ask an admin to approve your rider account.',
        '<button class="btn btn--primary" id="setup-rider">Set up rider profile</button>');
      var setup = document.getElementById('setup-rider');
      if (setup) setup.addEventListener('click', function () { riderSetup(session); });
      return;
    }

    if (!rider.is_approved) {
      main().innerHTML = ui.empty('Awaiting approval', 'An admin needs to approve your rider account before you can take jobs.');
      return;
    }

    if (rider.is_online) startLocationWatch(rider);
    else stopLocationWatch();

    var offers = await db.listOrders({ status: 'pending' });
    var mine = await db.listOrders({ riderId: rider.id });
    var active = mine.filter(function (o) {
      return ['accepted', 'arriving', 'picked_up', 'in_transit'].indexOf(o.status) > -1;
    })[0];

    main().innerHTML =
      '<div class="page page--rider">' +
        '<div class="rider-top">' +
          '<div><p class="eyebrow">Rider console</p><h1>' + (rider.is_online ? 'You are online 🟢' : 'Go online to work') + '</h1>' +
          '<p class="muted">' + ui.esc(rider.vehicle_type || 'Boda') + ' · ' + ui.esc(rider.plate_number || '') + '</p></div>' +
          '<button class="toggle ' + (rider.is_online ? 'is-on' : '') + '" id="online-toggle">' +
            '<span class="toggle__knob"></span><span>' + (rider.is_online ? 'Online' : 'Offline') + '</span></button>' +
        '</div>' +

        (active ? activeJobCard(active) : '') +

        '<div class="rider-stats">' +
          '<div><strong>' + mine.filter(function (o) { return o.status === 'completed'; }).length + '</strong><span>Completed</span></div>' +
          '<div><strong>' + ui.money(rider.total_earnings || 0) + '</strong><span>Total earned</span></div>' +
          '<div><strong>★ ' + Number(rider.rating || 5).toFixed(1) + '</strong><span>Rating</span></div>' +
        '</div>' +

        ui.section('Available jobs', rider.is_online ? offers.length + ' waiting' : 'Go online to see jobs') +
        '<div id="job-list">' +
          (offers.length ? offers.map(jobCard).join('') :
            ui.empty(rider.is_online ? 'No jobs right now' : 'You are offline',
              rider.is_online ? 'New requests will appear here automatically.' : 'Toggle online above to start receiving requests.')) +
        '</div>' +

        (mine.length ? ui.section('Your history', 'Recent jobs') +
          '<div class="compact-list">' + mine.slice(0, 6).map(function (o) {
            return '<div class="compact-row"><span>' + ui.esc(o.kind) + '</span>' +
              '<span class="muted">' + ui.esc(o.dropoff_address) + '</span>' + ui.statusPill(o.status) +
              '<strong>' + ui.money(o.total) + '</strong></div>';
          }).join('') + '</div>' : '') +
      '</div>';

    var toggle = document.getElementById('online-toggle');
    if (toggle) toggle.addEventListener('click', async function () {
      await db.updateRider(rider.id, { is_online: !rider.is_online });
      ui.toast(!rider.is_online ? 'You are online' : 'You are offline', 'success');
      jobs(ctx, session);
    });

    ui.on(main(), 'click', '[data-accept]', async function (e, btn) {
      var orderId = btn.getAttribute('data-accept');
      btn.disabled = true;
      btn.textContent = 'Accepting…';
      try {
        await db.updateOrder(orderId, { rider_id: rider.id, status: 'accepted' });
        await db.addOrderEvent(orderId, { status: 'accepted', note: 'Rider accepted the job' });
        await db.appendLedger({
          entity_type: 'order', entity_id: orderId, event_type: 'assigned',
          payload: { rider_id: rider.id, plate: rider.plate_number }, actor_id: session.user.id
        });
        ui.toast('Job accepted', 'success');
        jobs(ctx, session);
      } catch (err) {
        ui.toast(err.message || 'Could not accept job', 'error');
        btn.disabled = false;
        btn.textContent = 'Accept';
      }
    });

    ui.on(main(), 'click', '[data-status]', async function (e, btn) {
      var orderId = btn.getAttribute('data-status');
      var order = await db.getOrder(orderId);
      var status = nextStatus(order.status);
      if (!status) return;
      await db.updateOrder(orderId, { status: status });
      await db.addOrderEvent(orderId, { status: status, note: 'Rider updated status' });
      await db.appendLedger({
        entity_type: 'order', entity_id: orderId, event_type: status,
        payload: { status: status, rider_id: rider.id }, actor_id: session.user.id
      });
      if (status === 'completed') {
        await db.updateRider(rider.id, {
          total_earnings: Number(rider.total_earnings || 0) + Number(order.total || 0)
        });
        ui.toast('Job completed — ' + ui.money(order.total) + ' earned', 'success');
      } else {
        ui.toast('Status updated', 'success');
      }
      jobs(ctx, session);
    });

    clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (String(location.hash).indexOf('rider') > -1) jobs(ctx, session);
    }, 8000);

    ensureSubscription();
  }

  function jobCard(o) {
    var icon = o.kind === 'ride' ? '🏍' : o.kind === 'delivery' ? '📦' : '🛍';
    return '<div class="job-card">' +
      '<div class="job-card__head"><span class="job-card__icon">' + icon + '</span>' +
        '<span><strong>' + ui.esc(o.kind.charAt(0).toUpperCase() + o.kind.slice(1)) + ' request</strong>' +
        '<small class="muted">' + ui.timeAgo(o.created_at) + '</small></span>' +
        '<strong class="job-card__pay">' + ui.money(o.total) + '</strong></div>' +
      '<div class="job-card__route">' +
        '<div><span class="dot dot--green"></span>' + ui.esc(o.pickup_address) + '</div>' +
        '<div><span class="dot dot--lime"></span>' + ui.esc(o.dropoff_address) + '</div>' +
      '</div>' +
      (o.notes ? '<p class="muted small">' + ui.esc(o.notes) + '</p>' : '') +
      '<div class="job-card__actions">' +
        '<a class="btn btn--ghost btn--small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(o.dropoff_address || '') + '">Navigate</a>' +
        '<button class="btn btn--primary btn--small" data-accept="' + ui.esc(o.id) + '">Accept job</button>' +
      '</div>' +
    '</div>';
  }

  function activeJobCard(o) {
    return '<div class="active-job">' +
      '<div class="active-job__head"><span class="live-dot"></span><strong>Active job</strong>' + ui.statusPill(o.status) + '</div>' +
      '<div class="active-job__route">' +
        '<div><span class="dot dot--green"></span><div><small>Pickup</small><strong>' + ui.esc(o.pickup_address) + '</strong></div></div>' +
        '<div><span class="dot dot--lime"></span><div><small>Dropoff</small><strong>' + ui.esc(o.dropoff_address) + '</strong></div></div>' +
      '</div>' +
      '<div class="active-job__actions">' +
        '<a class="btn btn--ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(o.dropoff_address || '') + '">🧭 Navigate</a>' +
        (nextStatus(o.status) ? '<button class="btn btn--primary" data-status="' + ui.esc(o.id) + '">' + nextLabel(o.status) + '</button>' :
          '<a class="btn btn--primary" href="#/orders/' + ui.esc(o.id) + '">View details</a>') +
      '</div>' +
      '<p class="fineprint">' + ui.money(o.total) + ' · ' + ui.esc(o.kind) + '</p>' +
    '</div>';
  }

  async function riderSetup(session) {
    return ui.formModal('Set up your rider profile',
      ui.field('Vehicle type', 'vehicle_type', { value: 'Bajaj Boxer' }) +
      ui.field('Plate number', 'plate_number', { placeholder: 'KBZ 1234' }) +
      ui.field('Phone', 'phone', { value: session.profile.phone || '' }) +
      ui.field('City', 'city', { value: session.profile.city || 'Lilongwe' }),
      '<button class="btn btn--ghost" data-close>Cancel</button>' +
      '<button class="btn btn--primary" data-action="save">Save</button>'
    ).then(async function (result) {
      if (!result || result.action !== 'save') return;
      var v = result.values;
      var rider = await db.saveRider({
        profile_id: session.user.id, vehicle_type: v.vehicle_type,
        plate_number: v.plate_number, phone: v.phone, city: v.city,
        is_online: false, is_approved: db.isDemo(), lat: -13.9626, lng: 33.7741,
        heading: 0, rating: 5, total_earnings: 0
      });
      ui.toast(db.isDemo() ? 'Rider profile created' : 'Submitted for approval', 'success');
      router.resolve();
      return rider;
    });
  }

  async function earnings(ctx, session) {
    var rider = await db.getRiderForProfile(session.user.id);
    var orders = rider ? await db.listOrders({ riderId: rider.id }) : [];
    var completed = orders.filter(function (o) { return o.status === 'completed'; });
    var total = completed.reduce(function (n, o) { return n + Number(o.total || 0); }, 0);
    var today = completed.filter(function (o) {
      return new Date(o.created_at).toDateString() === new Date().toDateString();
    });

    main().innerHTML =
      '<div class="page page--earnings">' +
        '<div class="page-head"><a href="#/rider" class="back-link">← Jobs</a><h1>Earnings</h1></div>' +
        '<div class="earnings-hero"><small>Available balance</small><strong>' + ui.money(total) + '</strong>' +
          '<p class="muted">Lifetime earnings from ' + completed.length + ' completed jobs.</p></div>' +
        '<div class="rider-stats">' +
          '<div><strong>' + ui.money(today.reduce(function (n, o) { return n + Number(o.total || 0); }, 0)) + '</strong><span>Earned today</span></div>' +
          '<div><strong>' + today.length + '</strong><span>Jobs today</span></div>' +
          '<div><strong>★ ' + Number((rider && rider.rating) || 5).toFixed(1) + '</strong><span>Rating</span></div>' +
        '</div>' +
        ui.section('Recent payouts', 'Completed jobs') +
        (completed.length ? '<div class="compact-list">' + completed.map(function (o) {
          return '<div class="compact-row"><span><strong>' + ui.esc(o.kind) + '</strong><br><small class="muted">' + ui.date(o.created_at) + '</small></span>' +
            '<span class="muted">' + ui.esc(o.dropoff_address) + '</span><strong class="success-text">+' + ui.money(o.total) + '</strong></div>';
        }).join('') + '</div>' : ui.empty('No earnings yet', 'Complete a job to see it here.')) +
      '</div>';
  }

  async function profile(ctx, session) {
    var rider = await db.getRiderForProfile(session.user.id);
    var p = session.profile;
    main().innerHTML =
      '<div class="page page--profile">' +
        '<div class="page-head"><a href="#/rider" class="back-link">← Jobs</a><h1>Rider profile</h1></div>' +
        ui.card('<div class="profile-head">' + ui.avatar(p.full_name, p.avatar_url, 72) +
          '<div><h2>' + ui.esc(p.full_name) + '</h2><p class="muted">' + ui.esc(p.phone || '') + '</p>' +
          ui.statusPill(rider && rider.is_approved ? 'online' : 'pending_approval') + '</div></div>') +
        ui.card('<h3>Vehicle & details</h3>' +
          '<form id="rider-form" class="form-grid">' +
            ui.field('Full name', 'full_name', { value: p.full_name, required: true }) +
            ui.field('Phone', 'phone', { value: p.phone }) +
            ui.field('Vehicle type', 'vehicle_type', { value: (rider && rider.vehicle_type) || '' }) +
            ui.field('Plate number', 'plate_number', { value: (rider && rider.plate_number) || '' }) +
            '<div class="form-actions"><button class="btn btn--primary" type="submit">Save</button></div>' +
          '</form>') +
        ui.card('<h3>Account</h3>' +
          '<p class="muted">Rating: ★ ' + Number((rider && rider.rating) || 5).toFixed(1) +
            ' · Total earnings: ' + ui.money((rider && rider.total_earnings) || 0) + '</p>' +
          '<p class="fineprint">Location is shared while you are online so customers can track you.</p>') +
      '</div>';

    document.getElementById('rider-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = ui.formValues(e.target);
      try {
        var updated = await db.updateProfile(p.id, { full_name: v.full_name, phone: v.phone });
        KBZ.app.setSession(Object.assign({}, session, { profile: updated }));
        if (rider) await db.updateRider(rider.id, { vehicle_type: v.vehicle_type, plate_number: v.plate_number });
        ui.toast('Saved', 'success');
      } catch (err) {
        ui.toast(err.message || 'Could not save', 'error');
      }
    });
  }

  KBZ.rider = { jobs: jobs, earnings: earnings, profile: profile, stopLocationWatch: stopLocationWatch };
})();
