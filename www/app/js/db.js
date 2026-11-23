// KABAZA data layer.
// Uses Supabase when configured, otherwise a localStorage-backed demo store
// with the same async API so every screen works before credentials are added.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var cfg = window.KBZ_CONFIG || {};
  var client = null;
  var useDemo = !cfg.supabaseUrl || !cfg.supabaseAnonKey;
  var DEMO_KEY = 'kbz_demo_v3';
  var listeners = {};

  // ---------------------------------------------------------------- demo data
  var CATEGORIES = [
    { id: '00000000-0000-0000-0000-000000000101', name: 'Food', slug: 'food', kind: 'food', icon: '🍛', sort_order: 1 },
    { id: '00000000-0000-0000-0000-000000000102', name: 'Groceries', slug: 'grocery', kind: 'grocery', icon: '🛒', sort_order: 2 },
    { id: '00000000-0000-0000-0000-000000000103', name: 'Alcohol', slug: 'alcohol', kind: 'alcohol', icon: '🍺', sort_order: 3 },
    { id: '00000000-0000-0000-0000-000000000104', name: 'Drinks', slug: 'drinks', kind: 'grocery', icon: '🥤', sort_order: 4 }
  ];

  var VENDORS = [
    { id: '00000000-0000-0000-0000-000000000201', name: 'KabaZa Mart — Salima', category: 'general', logo_url: '', address: 'Town Centre, Salima', city: 'Salima', phone: '+265 111 000 001', is_active: true, is_kabaza_owned: true, created_at: new Date().toISOString() },
    { id: '00000000-0000-0000-0000-000000000202', name: 'KabaZa Mart — Salima', category: 'general', logo_url: '', address: 'Chipoka, Salima', city: 'Salima', phone: '+265 111 000 002', is_active: true, is_kabaza_owned: true, created_at: new Date().toISOString() },
    { id: '00000000-0000-0000-0000-000000000203', name: 'Salima Wholesale', category: 'grocery', logo_url: '', address: 'Senga Bay, Salima', city: 'Salima', phone: '+265 111 000 003', is_active: true, is_kabaza_owned: false, created_at: new Date().toISOString() },
    { id: '00000000-0000-0000-0000-000000000204', name: 'Mama Mia Takeaway', category: 'food', logo_url: '', address: 'Main Road, Salima', city: 'Salima', phone: '+265 111 000 004', is_active: true, is_kabaza_owned: false, created_at: new Date().toISOString() },
    { id: '00000000-0000-0000-0000-000000000205', name: 'Bottle Store 24', category: 'alcohol', logo_url: '', address: 'Chipoka, Salima', city: 'Salima', phone: '+265 111 000 005', is_active: true, is_kabaza_owned: false, created_at: new Date().toISOString() }
  ];

  var PRODUCT_SEED = [
    // ---- Alcohol (age restricted)
    ['Chibuku Shake Shake 500ml', 103, 1200, 201, 'kabaza', 24, 'Fermented maize drink, a Malawi classic.'],
    ['Carlsberg Lager 330ml', 103, 2800, 201, 'kabaza', 36, 'Crisp premium lager.'],
    ['Castle Lager 330ml', 103, 2600, 201, 'partner', 0, 'Bought from a partner bottle store.'],
    ['Mosi Lager 330ml', 103, 2500, 205, 'partner', 0, 'Bought from a partner bottle store.'],
    ['Malawi Gin 750ml', 103, 9500, 201, 'kabaza', 12, 'Distilled in Malawi.'],
    ['Kuche Kuche 750ml', 103, 6800, 205, 'partner', 0, 'Bought from a partner bottle store.'],
    ['Mtika 500ml', 103, 1500, 201, 'kabaza', 40, 'Local strong beer.'],
    ['Carlsberg Special Brew 500ml', 103, 4200, 205, 'partner', 0, 'Bought from a partner bottle store.'],
    ['Redds Apple Cider 330ml', 103, 2900, 201, 'kabaza', 18, 'Apple cider.'],
    ['Savanna Dry 330ml', 103, 3100, 205, 'partner', 0, 'Bought from a partner bottle store.'],
    // ---- Food
    ['Nsima & Chicken Plate', 101, 5500, 204, 'partner', 0, 'Grilled chicken with nsima and greens.'],
    ['Nsima & Fish Plate', 101, 6000, 204, 'partner', 0, 'Fried fish with nsima.'],
    ['Mandasi (6 pieces)', 101, 1200, 204, 'partner', 0, 'Malawian doughnuts.'],
    ['Roasted Chicken (whole)', 101, 12000, 201, 'kabaza', 8, 'Hot and ready to eat.'],
    ['Chicken Curry & Rice', 101, 6500, 204, 'partner', 0, 'With rice and vegetables.'],
    ['Samosa (4 pieces)', 101, 1500, 204, 'partner', 0, 'Spicy potato samosas.'],
    ['Thobwa 1 litre', 101, 900, 201, 'kabaza', 20, 'Traditional sorghum drink.'],
    ['Breakfast Bun & Tea', 101, 1800, 204, 'partner', 0, 'Fresh bun with milky tea.'],
    // ---- Groceries
    ['Maize Flour 2kg', 102, 2800, 201, 'kabaza', 60, 'For nsima.'],
    ['Sugar 1kg', 102, 1900, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Cooking Oil 1 litre', 102, 3200, 201, 'kabaza', 45, 'Vegetable cooking oil.'],
    ['Rice 2kg', 102, 4600, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Beans 1kg', 102, 2600, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Tea Leaves 250g', 102, 2200, 201, 'kabaza', 30, 'Black tea.'],
    ['Bread (white loaf)', 102, 1500, 201, 'kabaza', 25, 'Freshly baked.'],
    ['Eggs (6)', 102, 2400, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Salt 500g', 102, 700, 201, 'kabaza', 80, 'Iodised salt.'],
    ['Tomatoes 1kg', 102, 1800, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Onions 1kg', 102, 1600, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Milk 1 litre', 102, 1900, 201, 'kabaza', 22, 'Fresh milk.'],
    ['Peanut Butter 500g', 102, 3500, 203, 'partner', 0, 'Bought from a partner wholesaler.'],
    ['Charcoal 5kg', 102, 3000, 201, 'kabaza', 35, 'For cooking.'],
    // ---- Drinks
    ['Coca-Cola 500ml', 104, 1200, 201, 'kabaza', 50, 'Chilled soft drink.'],
    ['Fanta Orange 500ml', 104, 1200, 201, 'kabaza', 50, 'Chilled soft drink.'],
    ['Mineral Water 1 litre', 104, 800, 201, 'kabaza', 100, 'Bottled water.'],
    ['Milo 250g', 104, 3800, 203, 'partner', 0, 'Bought from a partner wholesaler.']
  ];

  function demoProducts() {
    return PRODUCT_SEED.map(function (p, i) {
      var cat = CATEGORIES.filter(function (c) { return c.id.indexOf(p[1].toString().padStart(16, '0')) > -1; })[0];
      var isAlcohol = p[1] === 103;
      return {
        id: '00000000-0000-0000-0000-' + String(1000 + i).padStart(12, '0'),
        vendor_id: '00000000-0000-0000-0000-0000000002' + String(p[3]).slice(-2),
        category_id: (cat && cat.id) || '00000000-0000-0000-0000-000000000102',
        name: p[0], description: p[5], price: p[2], image_url: '',
        sku: 'KBZ-' + String(1000 + i), stock_qty: p[6], is_active: true,
        source: p[4],
        source_label: p[4] === 'partner' ? 'Bought from a partner shop' : 'In KABAZA stock',
        age_restricted: isAlcohol, unit: 'each',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
    });
  }

  function demoDefaults() {
    return {
      profiles: [
        { id: 'demo-customer', role: 'customer', full_name: 'Chisomo Banda', phone: '+265 991 234 567', avatar_url: '', city: 'Salima', is_active: true, email: 'customer@kabaza.mw', created_at: new Date().toISOString() },
        { id: 'demo-rider', role: 'rider', full_name: 'Yamikani Phiri', phone: '+265 988 111 222', avatar_url: '', city: 'Salima', is_active: true, email: 'rider@kabaza.mw', created_at: new Date().toISOString() },
        { id: 'demo-admin', role: 'admin', full_name: 'KabaZa Operations', phone: '+265 111 000 000', avatar_url: '', city: 'Salima', is_active: true, email: 'admin@kabaza.mw', created_at: new Date().toISOString() }
      ],
      riders: [
        { id: '00000000-0000-0000-0000-000000000301', profile_id: 'demo-rider', vehicle_type: 'Bajaj Boxer', plate_number: 'KBZ 1234', phone: '+265 988 111 222', city: 'Salima', is_online: true, is_approved: true, lat: -13.8990, lng: 34.6020, heading: 45, rating: 4.9, total_earnings: 48200, created_at: new Date().toISOString() },
        { id: '00000000-0000-0000-0000-000000000302', profile_id: 'demo-rider-2', vehicle_type: 'TVS HLX', plate_number: 'KBZ 5678', phone: '+265 999 333 444', city: 'Salima', is_online: false, is_approved: true, lat: -13.7667, lng: 34.6167, heading: 0, rating: 4.7, total_earnings: 31500, created_at: new Date().toISOString() }
      ],
      vendors: VENDORS,
      categories: CATEGORIES,
      products: demoProducts(),
      zones: [
        { id: '00000000-0000-0000-0000-000000000401', name: 'Salima Town Centre', city: 'Salima', center_lat: -13.8990, center_lng: 34.6020, radius_km: 8, base_fare: 800, per_km: 300, is_active: true },
        { id: '00000000-0000-0000-0000-000000000402', name: 'Senga Bay', city: 'Salima', center_lat: -13.7667, center_lng: 34.6167, radius_km: 10, base_fare: 900, per_km: 300, is_active: true },
        { id: '00000000-0000-0000-0000-000000000403', name: 'Chipoka', city: 'Salima', center_lat: -13.9667, center_lng: 34.5333, radius_km: 7, base_fare: 800, per_km: 350, is_active: true },
        { id: '00000000-0000-0000-0000-000000000404', name: 'Kalimba', city: 'Salima', center_lat: -13.8800, center_lng: 34.6500, radius_km: 9, base_fare: 800, per_km: 300, is_active: true },
        { id: '00000000-0000-0000-0000-000000000405', name: 'Salima Fresh Market', city: 'Salima', center_lat: -13.9250, center_lng: 34.5800, radius_km: 8, base_fare: 800, per_km: 320, is_active: true }
      ],
      settings: {
        delivery_fee: 700,
        free_delivery_over: 25000,
        alcohol_notice: 'Alcohol is for customers aged 18 and over. We verify age on delivery.',
        support_phone: '+265 123 456 789',
        pricing_note: 'Fares are estimates. Final fare is confirmed by your rider.'
      },
      orders: [], order_items: [], order_events: [], payments: [],
      ledger_entries: [
        { id: uid('led'), seq: 1, entity_type: 'system', entity_id: '00000000-0000-0000-0000-000000000000', event_type: 'genesis', payload: { note: 'KABAZA provenance ledger initialised' }, prev_hash: '0000000000000000000000000000000000000000000000000000000000000000', hash: '5f2c8a91d4e07b63a9f2014ce6d83b770b21fa4e9c5d8063147b2e9a0d5c1f83', anchored_tx: null, anchored_at: null, actor_id: null, created_at: new Date().toISOString() },
        { id: uid('led'), seq: 2, entity_type: 'product', entity_id: '00000000-0000-0000-0000-000000001000', event_type: 'stocked', payload: { sku: 'KBZ-1000', source: 'kabaza', qty: 24 }, prev_hash: '5f2c8a91d4e07b63a9f2014ce6d83b770b21fa4e9c5d8063147b2e9a0d5c1f83', hash: '9a7d1e35c0b428af607d19e3b25c84fa17d0e6b938c2f45a71de0b3c86f2a940', anchored_tx: null, anchored_at: null, actor_id: null, created_at: new Date().toISOString() }
      ],
      demoEmail: 'customer@kabaza.mw', demoRole: 'customer'
    };
  }

  function readDemo() {
    try {
      var raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var data = demoDefaults();
    writeDemo(data);
    return data;
  }

  function writeDemo(data) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch (e) {}
    emit('change');
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function emit(table) {
    (listeners[table] || []).forEach(function (fn) {
      try { fn(); } catch (e) { console.error('listener error', e); }
    });
  }

  function delay(v) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(v); }, 60); });
  }

  // ------------------------------------------------------------------ supabase
  function sb() {
    if (!client && window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  function needSb() {
    var c = sb();
    if (!c) throw new Error('Supabase client is not available. Check config.js and vendor/supabase.js.');
    return c;
  }

  function unwrap(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  // ---------------------------------------------------------------------- init
  async function init() {
    if (useDemo) {
      readDemo();
      return { demo: true };
    }
    var c = needSb();
    c.channel('kbz-global').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, function () {
      emit('orders');
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'order_events' }, function () {
      emit('order_events');
    }).on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, function () {
      emit('riders');
    }).subscribe();
    return { demo: false };
  }

  function isDemo() { return useDemo; }

  // ---------------------------------------------------------------------- auth
  async function getSession() {
    if (useDemo) {
      var d = readDemo();
      if (!d.demoEmail) return null;
      var profile = d.profiles.filter(function (p) {
        return String(p.email || '').toLowerCase() === String(d.demoEmail).toLowerCase();
      })[0];
      if (!profile) {
        profile = {
          id: uid('usr'), role: d.demoRole || 'customer', full_name: 'KabaZa User',
          phone: '+265 999 000 000', avatar_url: '', city: 'Salima',
          is_active: true, email: d.demoEmail, created_at: new Date().toISOString()
        };
        d.profiles.push(profile);
        writeDemo(d);
      }
      return { user: { id: profile.id, email: profile.email }, profile: profile, demo: true };
    }
    var c = needSb();
    var result = await c.auth.getSession();
    var session = result.data && result.data.session;
    if (!session || !session.user) return null;
    var profile = await getProfile(session.user.id).catch(function () { return null; });
    return { user: session.user, profile: profile, demo: false };
  }

  async function signIn(email, password, role) {
    if (useDemo) {
      var d = readDemo();
      d.demoEmail = email || 'demo@kabaza.mw';
      d.demoRole = role || 'customer';
      var profile = d.profiles.filter(function (p) {
        return String(p.email || '').toLowerCase() === String(d.demoEmail).toLowerCase();
      })[0];
      if (!profile) {
        var name = email ? email.split('@')[0].replace(/[._-]/g, ' ') : 'KabaZa User';
        profile = {
          id: uid('usr'), role: d.demoRole, full_name: name.replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
          phone: '+265 999 000 000', avatar_url: '', city: 'Salima', is_active: true,
          email: d.demoEmail, created_at: new Date().toISOString()
        };
        d.profiles.push(profile);
        if (d.demoRole === 'rider') {
          d.riders.push({
            id: uid('rider'), profile_id: profile.id, vehicle_type: 'Bajaj Boxer',
            plate_number: 'KBZ 0000', phone: profile.phone, city: 'Salima',
            is_online: false, is_approved: true, lat: -13.9626, lng: 33.7741,
            heading: 0, rating: 5, total_earnings: 0, created_at: new Date().toISOString()
          });
        }
      } else if (role) {
        profile.role = role;
      }
      writeDemo(d);
      return getSession();
    }
    var c = needSb();
    var result = await c.auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw result.error;
    return getSession();
  }

  async function signUp(email, password, meta) {
    if (useDemo) return signIn(email, password, (meta && meta.role) || 'customer');
    var c = needSb();
    var result = await c.auth.signUp({
      email: email, password: password,
      options: { data: meta || {} }
    });
    if (result.error) throw result.error;
    return getSession();
  }

  // Supabase persists its session under `sb-<project-ref>-auth-token`. If the
  // network call hangs (common on flaky mobile data) we still clear local state
  // so the user is never trapped in a "signed out but still logged in" screen.
  function clearLocalAuth() {
    try {
      Object.keys(localStorage).filter(function (k) {
        return k.indexOf('sb-') === 0;
      }).forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    try {
      Object.keys(sessionStorage).filter(function (k) {
        return k.indexOf('sb-') === 0;
      }).forEach(function (k) { sessionStorage.removeItem(k); });
    } catch (e) {}
  }

  async function signOut() {
    if (useDemo) {
      var d = readDemo();
      d.demoEmail = '';
      writeDemo(d);
      clearLocalAuth();
      return;
    }
    var c = needSb();
    try {
      // Never let a slow auth server block the UI. The local fallback below is
      // authoritative for this device; the server token is invalidated when the
      // request eventually completes (or expires naturally).
      await Promise.race([
        c.auth.signOut(),
        new Promise(function (resolve) { setTimeout(resolve, 4500); })
      ]).catch(function (e) {
        if (window.console && console.warn) console.warn('[KABAZA] remote sign-out failed:', e && e.message);
      });
    } finally {
      clearLocalAuth();
      client = null; // force a clean client on the next boot
    }
  }

  // Used after server-verified phone OTP registration/login: the backend hands
  // back short-lived Supabase tokens over HTTPS, never a password or OTP code.
  async function setSessionFromTokens(accessToken, refreshToken) {
    if (useDemo) throw new Error('Phone sign-in is not available in demo mode');
    var result = await needSb().auth.setSession({
      access_token: String(accessToken || ''),
      refresh_token: String(refreshToken || '')
    });
    if (result.error) throw result.error;
    return getSession();
  }

  // ------------------------------------------------------------------ profiles
  async function getProfile(id) {
    if (useDemo) {
      var p = readDemo().profiles.filter(function (x) { return x.id === id; })[0];
      return p || null;
    }
    return unwrap(await needSb().from('profiles').select('*').eq('id', id).maybeSingle());
  }

  async function updateProfile(id, patch) {
    if (useDemo) {
      var d = readDemo();
      d.profiles = d.profiles.map(function (p) {
        return p.id === id ? Object.assign({}, p, patch) : p;
      });
      writeDemo(d);
      return d.profiles.filter(function (p) { return p.id === id; })[0];
    }
    return unwrap(await needSb().from('profiles').update(patch).eq('id', id).select().single());
  }

  // Demo-only helper for admin-created users. In live mode profiles are created
  // by the handle_new_user() trigger when a user signs up through Supabase Auth.
  async function createProfile(profile) {
    if (!useDemo) return null;
    var d = readDemo();
    var row = Object.assign({
      id: uid('usr'), role: 'customer', full_name: 'New user',
      phone: '', avatar_url: '', city: 'Salima', is_active: true,
      created_at: new Date().toISOString()
    }, profile || {});
    d.profiles.push(row);
    writeDemo(d);
    return row;
  }

  async function listUsers() {
    if (useDemo) return readDemo().profiles.slice();
    return unwrap(await needSb().from('profiles').select('*').order('created_at', { ascending: false }));
  }

  // ------------------------------------------------------------------ catalog
  async function listProducts(filters) {
    filters = filters || {};
    if (useDemo) {
      var list = readDemo().products.slice();
      if (filters.category) list = list.filter(function (p) { return p.category_id === filters.category; });
      if (filters.categorySlug) {
        var cat = readDemo().categories.filter(function (c) { return c.slug === filters.categorySlug; })[0];
        list = cat ? list.filter(function (p) { return p.category_id === cat.id; }) : [];
      }
      if (filters.q) {
        var q = String(filters.q).toLowerCase();
        list = list.filter(function (p) {
          return (p.name + ' ' + (p.description || '')).toLowerCase().indexOf(q) > -1;
        });
      }
      if (filters.activeOnly !== false) list = list.filter(function (p) { return p.is_active; });
      return list;
    }
    var query = needSb().from('products').select('*');
    if (filters.category) query = query.eq('category_id', filters.category);
    if (filters.q) query = query.or('name.ilike.%' + filters.q + '%,description.ilike.%' + filters.q + '%');
    if (filters.activeOnly !== false) query = query.eq('is_active', true);
    return unwrap(await query.order('name'));
  }

  async function getProduct(id) {
    if (useDemo) return readDemo().products.filter(function (p) { return p.id === id; })[0] || null;
    return unwrap(await needSb().from('products').select('*').eq('id', id).maybeSingle());
  }

  async function saveProduct(product) {
    if (!product.id) product.id = uid('prod');
    product.updated_at = new Date().toISOString();
    if (useDemo) {
      var d = readDemo();
      var idx = -1;
      d.products.forEach(function (p, i) { if (p.id === product.id) idx = i; });
      if (idx > -1) d.products[idx] = Object.assign({}, d.products[idx], product);
      else d.products.push(product);
      writeDemo(d);
      return product;
    }
    return unwrap(await needSb().from('products').upsert(product).select().single());
  }

  async function deleteProduct(id) {
    if (useDemo) {
      var d = readDemo();
      d.products = d.products.filter(function (p) { return p.id !== id; });
      writeDemo(d);
      return;
    }
    return unwrap(await needSb().from('products').delete().eq('id', id));
  }

  async function listCategories() {
    if (useDemo) return readDemo().categories.slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
    return unwrap(await needSb().from('categories').select('*').order('sort_order'));
  }

  async function listVendors() {
    if (useDemo) return readDemo().vendors.slice();
    return unwrap(await needSb().from('vendors').select('*').order('name'));
  }

  async function saveVendor(vendor) {
    if (!vendor.id) vendor.id = uid('vend');
    if (useDemo) {
      var d = readDemo();
      var idx = -1;
      d.vendors.forEach(function (v, i) { if (v.id === vendor.id) idx = i; });
      if (idx > -1) d.vendors[idx] = Object.assign({}, d.vendors[idx], vendor);
      else d.vendors.push(vendor);
      writeDemo(d);
      return vendor;
    }
    return unwrap(await needSb().from('vendors').upsert(vendor).select().single());
  }

  async function deleteVendor(id) {
    if (useDemo) {
      var d = readDemo();
      d.vendors = d.vendors.filter(function (v) { return v.id !== id; });
      writeDemo(d);
      return;
    }
    return unwrap(await needSb().from('vendors').delete().eq('id', id));
  }

  async function listZones() {
    if (useDemo) return readDemo().zones.slice();
    return unwrap(await needSb().from('zones').select('*').order('name'));
  }

  async function saveZone(zone) {
    if (!zone.id) zone.id = uid('zone');
    if (useDemo) {
      var d = readDemo();
      var idx = -1;
      d.zones.forEach(function (z, i) { if (z.id === zone.id) idx = i; });
      if (idx > -1) d.zones[idx] = Object.assign({}, d.zones[idx], zone);
      else d.zones.push(zone);
      writeDemo(d);
      return zone;
    }
    return unwrap(await needSb().from('zones').upsert(zone).select().single());
  }

  async function getSettings() {
    if (useDemo) return readDemo().settings;
    var rows = unwrap(await needSb().from('settings').select('*'));
    var out = {};
    rows.forEach(function (row) { out[row.key] = row.value; });
    return out;
  }

  async function saveSetting(key, value) {
    if (useDemo) {
      var d = readDemo();
      d.settings[key] = value;
      writeDemo(d);
      return;
    }
    return unwrap(await needSb().from('settings').upsert({
      key: key, value: value, updated_at: new Date().toISOString()
    }));
  }

  // -------------------------------------------------------------------- riders
  async function listRiders() {
    if (useDemo) return readDemo().riders.slice();
    return unwrap(await needSb().from('riders').select('*').order('created_at', { ascending: false }));
  }

  async function getRider(id) {
    if (useDemo) return readDemo().riders.filter(function (r) { return r.id === id; })[0] || null;
    return unwrap(await needSb().from('riders').select('*').eq('id', id).maybeSingle());
  }

  async function getRiderForProfile(profileId) {
    if (useDemo) return readDemo().riders.filter(function (r) { return r.profile_id === profileId; })[0] || null;
    return unwrap(await needSb().from('riders').select('*').eq('profile_id', profileId).maybeSingle());
  }

  async function saveRider(rider) {
    if (!rider.id) rider.id = uid('rider');
    if (useDemo) {
      var d = readDemo();
      var idx = -1;
      d.riders.forEach(function (r, i) { if (r.id === rider.id) idx = i; });
      if (idx > -1) d.riders[idx] = Object.assign({}, d.riders[idx], rider);
      else d.riders.push(rider);
      writeDemo(d);
      return rider;
    }
    return unwrap(await needSb().from('riders').upsert(rider).select().single());
  }

  async function updateRider(id, patch) {
    if (useDemo) {
      var d = readDemo();
      d.riders = d.riders.map(function (r) {
        return r.id === id ? Object.assign({}, r, patch) : r;
      });
      writeDemo(d);
      return d.riders.filter(function (r) { return r.id === id; })[0];
    }
    return unwrap(await needSb().from('riders').update(patch).eq('id', id).select().single());
  }

  // -------------------------------------------------------------------- orders
  async function createOrder(order) {
    if (!order.id) order.id = uid('ord');
    order.created_at = new Date().toISOString();
    order.updated_at = order.created_at;
    order.status = order.status || 'pending';
    if (useDemo) {
      var d = readDemo();
      d.orders.unshift(order);
      (order.items || []).forEach(function (item) {
        d.order_items.push(Object.assign({ id: uid('item'), order_id: order.id }, item));
      });
      d.order_events.push({
        id: uid('evt'), order_id: order.id, status: 'pending',
        note: 'Order placed', lat: order.pickup_lat || null, lng: order.pickup_lng || null,
        created_at: order.created_at
      });
      writeDemo(d);
      return order;
    }
    var items = order.items || [];
    delete order.items;
    var created = unwrap(await needSb().from('orders').insert(order).select().single());
    if (items.length) {
      await needSb().from('order_items').insert(items.map(function (item) {
        return Object.assign({ order_id: created.id }, item);
      }));
    }
    await addOrderEvent(created.id, { status: 'pending', note: 'Order placed' });
    return created;
  }

  async function getOrder(id) {
    if (useDemo) return readDemo().orders.filter(function (o) { return o.id === id; })[0] || null;
    return unwrap(await needSb().from('orders').select('*').eq('id', id).maybeSingle());
  }

  async function listOrders(filters) {
    filters = filters || {};
    if (useDemo) {
      var list = readDemo().orders.slice();
      if (filters.customerId) list = list.filter(function (o) { return o.customer_id === filters.customerId; });
      if (filters.riderId) list = list.filter(function (o) { return o.rider_id === filters.riderId; });
      if (filters.status) list = list.filter(function (o) { return o.status === filters.status; });
      if (filters.kind) list = list.filter(function (o) { return o.kind === filters.kind; });
      return list;
    }
    var query = needSb().from('orders').select('*');
    if (filters.customerId) query = query.eq('customer_id', filters.customerId);
    if (filters.riderId) query = query.eq('rider_id', filters.riderId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.kind) query = query.eq('kind', filters.kind);
    return unwrap(await query.order('created_at', { ascending: false }).limit(200));
  }

  async function updateOrder(id, patch) {
    patch.updated_at = new Date().toISOString();
    if (useDemo) {
      var d = readDemo();
      d.orders = d.orders.map(function (o) {
        return o.id === id ? Object.assign({}, o, patch) : o;
      });
      writeDemo(d);
      return d.orders.filter(function (o) { return o.id === id; })[0];
    }
    return unwrap(await needSb().from('orders').update(patch).eq('id', id).select().single());
  }

  async function listOrderItems(orderId) {
    if (useDemo) return readDemo().order_items.filter(function (i) { return i.order_id === orderId; });
    return unwrap(await needSb().from('order_items').select('*').eq('order_id', orderId));
  }

  async function addOrderEvent(orderId, event) {
    event = event || {};
    var row = {
      id: uid('evt'), order_id: orderId, status: event.status || 'update',
      note: event.note || '', lat: event.lat || null, lng: event.lng || null,
      created_at: new Date().toISOString()
    };
    if (useDemo) {
      var d = readDemo();
      d.order_events.push(row);
      writeDemo(d);
      return row;
    }
    return unwrap(await needSb().from('order_events').insert(row).select().single());
  }

  async function listOrderEvents(orderId) {
    if (useDemo) {
      return readDemo().order_events.filter(function (e) { return e.order_id === orderId; })
        .sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
    }
    return unwrap(await needSb().from('order_events').select('*')
      .eq('order_id', orderId).order('created_at'));
  }

  // ------------------------------------------------------------------ payments
  async function listPayments(filters) {
    filters = filters || {};
    if (useDemo) {
      var list = readDemo().payments.slice();
      if (filters.orderId) list = list.filter(function (p) { return p.order_id === filters.orderId; });
      return list;
    }
    var q = needSb().from('payments').select('*');
    if (filters.orderId) q = q.eq('order_id', filters.orderId);
    return unwrap(await q.order('created_at', { ascending: false }));
  }

  async function savePayment(payment) {
    if (!payment.id) payment.id = uid('pay');
    payment.created_at = payment.created_at || new Date().toISOString();
    if (useDemo) {
      var d = readDemo();
      var idx = -1;
      d.payments.forEach(function (p, i) { if (p.tx_ref === payment.tx_ref) idx = i; });
      if (idx > -1) d.payments[idx] = Object.assign({}, d.payments[idx], payment);
      else d.payments.push(payment);
      writeDemo(d);
      return payment;
    }
    return unwrap(await needSb().from('payments').upsert(payment, { onConflict: 'tx_ref' }).select().single());
  }

  // --------------------------------------------------------- provenance ledger
  async function listLedger(filters) {
    filters = filters || {};
    if (useDemo) {
      var list = readDemo().ledger_entries.slice();
      if (filters.entityId) list = list.filter(function (e) { return e.entity_id === filters.entityId; });
      if (filters.entityType) list = list.filter(function (e) { return e.entity_type === filters.entityType; });
      return list.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    }
    var q = needSb().from('ledger_entries').select('*');
    if (filters.entityId) q = q.eq('entity_id', filters.entityId);
    if (filters.entityType) q = q.eq('entity_type', filters.entityType);
    return unwrap(await q.order('seq'));
  }

  // In demo mode we can compute the chain locally. In production, writes go
  // through the backend's append_ledger_entry() SQL function (service role),
  // never directly from the client, so the chain cannot be forged.
  function hashChain(prevHash, parts) {
    var input = String(prevHash || '') + '|' + parts.join('|');
    var h = 0;
    for (var i = 0; i < input.length; i++) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    var hex = (h >>> 0).toString(16).padStart(8, '0');
    return (hex + hex + hex + hex + hex + hex + hex + hex).slice(0, 64);
  }

  function ledgerApiBase() {
    return String(cfg.paymentApiBase || '').replace(/\/+$/, '');
  }

  async function appendLedger(entry) {
    if (useDemo) {
      var d = readDemo();
      var last = d.ledger_entries[d.ledger_entries.length - 1];
      var prev = last ? last.hash : '0'.repeat(64);
      var seq = (last && last.seq ? last.seq : 0) + 1;
      var row = {
        id: uid('led'), seq: seq,
        entity_type: entry.entity_type || 'order',
        entity_id: entry.entity_id || '',
        event_type: entry.event_type || 'update',
        payload: entry.payload || {},
        prev_hash: prev,
        hash: hashChain(prev, [seq, entry.entity_type, entry.entity_id, entry.event_type, JSON.stringify(entry.payload || {})]),
        anchored_tx: null, anchored_at: null,
        actor_id: entry.actor_id || null,
        created_at: new Date().toISOString()
      };
      d.ledger_entries.push(row);
      writeDemo(d);
      return row;
    }
    // Live mode: provenance writes go through the backend service, which calls
    // the security-definer append_ledger_entry() RPC with the service role. The
    // client never writes ledger_entries directly, so the hash chain cannot be
    // forged from the browser. If no backend is configured yet, skip silently
    // so normal order/payment flows still work; the entry is simply not recorded.
    var base = ledgerApiBase();
    if (!/^https?:\/\//i.test(base)) return null;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    try {
      var res = await fetch(base + '/api/ledger/append', {
        method: 'POST',
        signal: controller ? controller.signal : undefined,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_type: entry.entity_type || 'order',
          entity_id: entry.entity_id || null,
          event_type: entry.event_type || 'update',
          payload: entry.payload || {},
          actor_id: entry.actor_id || null
        })
      });
      var body = await res.json().catch(function () { return null; });
      if (!res.ok) {
        throw new Error((body && (body.message || body.error)) || ('HTTP ' + res.status));
      }
      return (body && body.entry) || body || null;
    } catch (e) {
      // Ledger writes are best-effort here: a network or backend problem must
      // never roll back a successful order/payment. Surface it in the console.
      if (window.console && console.warn) {
        console.warn('[KABAZA] ledger append skipped:', e && e.message);
      }
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ----------------------------------------------------------------- subscribe
  function subscribe(table, fn) {
    if (!listeners[table]) listeners[table] = [];
    listeners[table].push(fn);
    return function () {
      listeners[table] = listeners[table].filter(function (f) { return f !== fn; });
    };
  }

  KBZ.db = {
    init: init, isDemo: isDemo, uid: uid,
    getSession: getSession, signIn: signIn, signUp: signUp, signOut: signOut,
    setSessionFromTokens: setSessionFromTokens,
    getProfile: getProfile, updateProfile: updateProfile, createProfile: createProfile, listUsers: listUsers,
    listProducts: listProducts, getProduct: getProduct, saveProduct: saveProduct, deleteProduct: deleteProduct,
    listCategories: listCategories,
    listVendors: listVendors, saveVendor: saveVendor, deleteVendor: deleteVendor,
    listZones: listZones, saveZone: saveZone,
    getSettings: getSettings, saveSetting: saveSetting,
    listRiders: listRiders, getRider: getRider, getRiderForProfile: getRiderForProfile,
    saveRider: saveRider, updateRider: updateRider,
    createOrder: createOrder, getOrder: getOrder, listOrders: listOrders, updateOrder: updateOrder,
    listOrderItems: listOrderItems, addOrderEvent: addOrderEvent, listOrderEvents: listOrderEvents,
    listPayments: listPayments, savePayment: savePayment,
    listLedger: listLedger, appendLedger: appendLedger,
    subscribe: subscribe
  };
})();
