// Admin console: stock, pricing, orders, riders, users, vendors, provenance.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var ui = KBZ.ui;
  var db = KBZ.db;
  var router = KBZ.router;

  function main() { return document.getElementById('main'); }

  function page(title, subtitle, actions, body) {
    return '<div class="page page--admin">' +
      '<div class="page-head"><div><p class="eyebrow">KABAZA operations</p><h1>' + ui.esc(title) + '</h1>' +
      (subtitle ? '<p class="muted">' + ui.esc(subtitle) + '</p>' : '') + '</div>' +
      (actions ? '<div class="page-actions">' + actions + '</div>' : '') + '</div>' + body + '</div>';
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return ui.empty(emptyText || 'Nothing to show', '');
    return '<div class="table-wrap"><table class="table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + ui.esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  // --------------------------------------------------------------- dashboard
  async function dashboard(ctx, session) {
    var orders = await db.listOrders();
    var products = await db.listProducts({ activeOnly: false });
    var riders = await db.listRiders();
    var users = await db.listUsers();
    var payments = await db.listPayments();
    var today = orders.filter(function (o) {
      return new Date(o.created_at).toDateString() === new Date().toDateString();
    });
    var revenue = orders.filter(function (o) { return o.payment_status === 'paid'; })
      .reduce(function (n, o) { return n + Number(o.total || 0); }, 0);
    var lowStock = products.filter(function (p) {
      return p.source === 'kabaza' && Number(p.stock_qty) < 10;
    });
    var activeOrders = orders.filter(function (o) {
      return ['pending', 'accepted', 'arriving', 'picked_up', 'in_transit'].indexOf(o.status) > -1;
    });
    var partnerCount = products.filter(function (p) { return p.source === 'partner'; }).length;

    main().innerHTML = page('Dashboard', 'Overview of everything happening on KABAZA.',
      '<a class="btn btn--primary" href="#/admin/products">+ Add product</a>',
      '<div class="kpi-grid">' +
        '<div class="kpi"><span>Orders today</span><strong>' + today.length + '</strong><small>' + activeOrders.length + ' active now</small></div>' +
        '<div class="kpi"><span>Revenue (paid)</span><strong>' + ui.money(revenue) + '</strong><small>' + payments.length + ' transactions</small></div>' +
        '<div class="kpi"><span>Active riders</span><strong>' + riders.filter(function (r) { return r.is_online; }).length + '</strong><small>of ' + riders.length + ' registered</small></div>' +
        '<div class="kpi"><span>Products</span><strong>' + products.length + '</strong><small>' + partnerCount + ' partner-sourced</small></div>' +
      '</div>' +

      (lowStock.length ? '<div class="notice notice--warn"><strong>' + lowStock.length +
        ' items are low on stock.</strong> <a href="#/admin/products">Review products →</a></div>' : '') +

      '<div class="dash-columns">' +
        '<div>' + ui.section('Recent orders', 'Latest customer activity', '<a class="link-arrow" href="#/admin/orders">All orders →</a>') +
          '<div class="compact-list">' + orders.slice(0, 6).map(function (o) {
            return '<a class="compact-row" href="#/orders/' + ui.esc(o.id) + '">' +
              '<span><strong>' + ui.esc(o.kind) + '</strong><br><small class="muted">' + ui.esc(o.dropoff_address || '—') + '</small></span>' +
              ui.statusPill(o.status) + '<strong>' + ui.money(o.total) + '</strong></a>';
          }).join('') + '</div>' +
        '</div>' +
        '<div>' + ui.section('Stock watch', 'KABAZA-owned products') +
          '<div class="compact-list">' + (lowStock.length ? lowStock.slice(0, 6).map(function (p) {
            return '<div class="compact-row"><span>' + ui.esc(p.name) + '</span>' +
              '<span class="pill pill--warning">' + Number(p.stock_qty) + ' left</span></div>';
          }).join('') : '<p class="muted">All stock levels look healthy.</p>') + '</div>' +
          ui.section('Team', 'Accounts') +
          '<div class="compact-list">' +
            '<div class="compact-row"><span>Admins</span><strong>' + users.filter(function (u) { return u.role === 'admin'; }).length + '</strong></div>' +
            '<div class="compact-row"><span>Riders</span><strong>' + users.filter(function (u) { return u.role === 'rider'; }).length + '</strong></div>' +
            '<div class="compact-row"><span>Customers</span><strong>' + users.filter(function (u) { return u.role === 'customer'; }).length + '</strong></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="notice notice--info">⛓ Every order is written to a hash-chained provenance ledger. ' +
        '<a href="#/admin/ledger">View ledger →</a></div>'
    );
  }

  // ---------------------------------------------------------------- products
  async function products(ctx, session) {
    var products = await db.listProducts({ activeOnly: false });
    var categories = await db.listCategories();
    var vendors = await db.listVendors();
    var filter = ctx.query.filter || 'all';

    main().innerHTML = page('Products', 'Manage catalog, stock and where each item comes from.',
      '<button class="btn btn--primary" id="add-product">+ Add product</button>',
      '<div class="toolbar">' +
        '<input class="input" id="product-filter-text" placeholder="Search products…">' +
        '<select class="input" id="product-filter-source">' +
          '<option value="all">All sources</option>' +
          '<option value="kabaza" ' + (filter === 'kabaza' ? 'selected' : '') + '>In KABAZA stock</option>' +
          '<option value="partner" ' + (filter === 'partner' ? 'selected' : '') + '>Bought elsewhere</option>' +
        '</select>' +
      '</div>' +
      '<div id="products-table">' + productsTable(products, categories, filter) + '</div>' +
      '<p class="fineprint">Source labels are shown to customers on every product. ' +
        '<strong>In KABAZA stock</strong> means we hold the inventory; ' +
        '<strong>Bought elsewhere</strong> means a partner sources it at purchase time.</p>'
    );

    function rerender() {
      var q = ui.qs('#product-filter-text').value.toLowerCase();
      var src = ui.qs('#product-filter-source').value;
      var list = products.filter(function (p) {
        return (src === 'all' || p.source === src) &&
          (!q || (p.name + ' ' + (p.description || '')).toLowerCase().indexOf(q) > -1);
      });
      ui.qs('#products-table').innerHTML = productsTable(list, categories, src);
      wireRows();
    }

    function wireRows() {
      ui.on(ui.qs('#products-table'), 'click', '[data-edit-product]', async function (e, btn) {
        var p = products.filter(function (x) { return x.id === btn.getAttribute('data-edit-product'); })[0];
        if (p) { await productForm(p, categories, vendors, session); products(ctx, session); }
      });
      ui.on(ui.qs('#products-table'), 'click', '[data-toggle-product]', async function (e, btn) {
        var p = products.filter(function (x) { return x.id === btn.getAttribute('data-toggle-product'); })[0];
        if (!p) return;
        await db.saveProduct(Object.assign({}, p, { is_active: !p.is_active }));
        await db.appendLedger({
          entity_type: 'product', entity_id: p.id,
          event_type: p.is_active ? 'deactivated' : 'activated',
          payload: { name: p.name }, actor_id: session.user.id
        });
        ui.toast('Product updated', 'success');
        products(ctx, session);
      });
      ui.on(ui.qs('#products-table'), 'click', '[data-delete-product]', async function (e, btn) {
        var id = btn.getAttribute('data-delete-product');
        if (await ui.confirm('Delete product?', 'This cannot be undone.', 'Delete')) {
          await db.deleteProduct(id);
          ui.toast('Product deleted', 'success');
          products(ctx, session);
        }
      });
    }

    ui.qs('#add-product').addEventListener('click', async function () {
      await productForm(null, categories, vendors, session);
      products(ctx, session);
    });
    ui.qs('#product-filter-text').addEventListener('input', rerender);
    ui.qs('#product-filter-source').addEventListener('change', function () {
      ui.qs('#products-table').innerHTML = productsTable(products, categories, this.value);
      wireRows();
    });
    wireRows();
  }

  function productsTable(list, categories, filter) {
    return table(['Product', 'Category', 'Source', 'Price', 'Stock', 'Status', 'Actions'],
      list.map(function (p) {
        var cat = categories.filter(function (c) { return c.id === p.category_id; })[0];
        return '<tr>' +
          '<td><strong>' + ui.esc(p.name) + '</strong><br><small class="muted">' + ui.esc(p.sku || '') + '</small>' +
            (p.age_restricted ? ' ' + ui.ageBadge() : '') + '</td>' +
          '<td>' + ui.esc(cat ? cat.name : '—') + '</td>' +
          '<td>' + ui.sourceBadge(p) + '</td>' +
          '<td>' + ui.money(p.price) + '</td>' +
          '<td>' + (p.source === 'kabaza' ? '<span class="' + (Number(p.stock_qty) < 10 ? 'danger-text' : '') + '">' + Number(p.stock_qty) + '</span>' : '—') + '</td>' +
          '<td>' + ui.statusPill(p.is_active ? 'online' : 'offline') + '</td>' +
          '<td class="actions-cell">' +
            '<button class="icon-btn" data-edit-product="' + ui.esc(p.id) + '" title="Edit">✎</button>' +
            '<button class="icon-btn" data-toggle-product="' + ui.esc(p.id) + '" title="Activate / deactivate">◉</button>' +
            '<button class="icon-btn icon-btn--danger" data-delete-product="' + ui.esc(p.id) + '" title="Delete">×</button>' +
          '</td></tr>';
      }), 'No products found');
  }

  async function productForm(product, categories, vendors, session) {
    var isEdit = Boolean(product && product.id);
    var html =
      ui.field('Product name', 'name', { value: product && product.name, required: true }) +
      '<div class="form-grid">' +
        ui.field('Category', 'category_id', { type: 'select', value: (product && product.category_id) || categories[0].id,
          options: categories.map(function (c) { return { value: c.id, label: c.icon + ' ' + c.name }; }) }) +
        ui.field('Supplier / vendor', 'vendor_id', { type: 'select', value: (product && product.vendor_id) || '',
          options: [{ value: '', label: 'None' }].concat(vendors.map(function (v) {
            return { value: v.id, label: v.name };
          })) }) +
      '</div>' +
      '<div class="form-grid">' +
        ui.field('Price (MWK)', 'price', { type: 'number', min: '0', step: '1', value: (product && product.price) || 0, required: true }) +
        ui.field('Stock quantity', 'stock_qty', { type: 'number', min: '0', step: '1', value: (product && product.stock_qty) || 0 }) +
      '</div>' +
      ui.field('Description', 'description', { type: 'textarea', value: product && product.description }) +
      ui.field('Image URL (optional)', 'image_url', { value: product && product.image_url, placeholder: 'https://…' }) +
      '<div class="form-grid">' +
        ui.field('SKU', 'sku', { value: product && product.sku }) +
        ui.field('Unit', 'unit', { value: (product && product.unit) || 'each' }) +
      '</div>' +
      '<hr>' +
      ui.field('Source', 'source', { type: 'select', value: (product && product.source) || 'kabaza',
        options: [{ value: 'kabaza', label: 'In KABAZA stock (we hold inventory)' },
                  { value: 'partner', label: 'Bought elsewhere (partner sourced)' }] }) +
      ui.field('Customer-facing source label', 'source_label', {
        value: product && product.source_label,
        placeholder: 'In KABAZA stock / Bought from a partner shop' }) +
      '<div class="check-row"><input type="checkbox" name="age_restricted" id="age-restricted"' +
        ((product && product.age_restricted) ? ' checked' : '') + '><label for="age-restricted">Age restricted (18+)</label></div>' +
      '<div class="check-row"><input type="checkbox" name="is_active" id="is-active"' +
        ((!product || product.is_active) ? ' checked' : '') + '><label for="is-active">Active / visible to customers</label></div>';

    return new Promise(function (resolve) {
      var overlay = ui.el('<div class="modal-overlay"><div class="modal modal--wide" role="dialog">' +
        '<div class="modal__head"><h3>' + (isEdit ? 'Edit product' : 'New product') + '</h3>' +
        '<button class="icon-btn" data-cancel>&times;</button></div>' +
        '<form id="product-form"><div class="modal__body">' + html + '</div>' +
        '<div class="modal__foot"><button type="button" class="btn btn--ghost" data-cancel>Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + (isEdit ? 'Save product' : 'Add product') + '</button></div></form>' +
        '</div></div>');

      function close(value) {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(value);
      }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-cancel]')) close(null);
      });
      overlay.addEventListener('submit', async function (e) {
        e.preventDefault();
        var form = e.target;
        var v = ui.formValues(form);
        v.price = Number(v.price);
        v.stock_qty = Number(v.stock_qty);
        v.age_restricted = ui.qs('[name="age_restricted"]', form).checked;
        v.is_active = ui.qs('[name="is_active"]', form).checked;
        if (!v.source_label) v.source_label = v.source === 'partner' ? 'Bought from a partner shop' : 'In KABAZA stock';
        var saved = Object.assign({}, product || {}, v);
        if (!saved.id) saved.id = db.uid('prod');
        try {
          await db.saveProduct(saved);
          await db.appendLedger({
            entity_type: 'product', entity_id: saved.id,
            event_type: isEdit ? 'product_updated' : 'stocked',
            payload: { name: saved.name, price: saved.price, source: saved.source, stock: saved.stock_qty },
            actor_id: session.user.id
          });
          ui.toast(isEdit ? 'Product saved' : 'Product added', 'success');
          close(saved);
        } catch (err) {
          ui.toast(err.message || 'Could not save product', 'error');
        }
      });
      document.body.appendChild(overlay);
    });
  }

  // ---------------------------------------------------------------- vendors
  async function vendors(ctx, session) {
    var vendors = await db.listVendors();
    main().innerHTML = page('Vendors & suppliers', 'Where our products come from.',
      '<button class="btn btn--primary" id="add-vendor">+ Add vendor</button>',
      table(['Name', 'Category', 'City', 'Type', 'Contact', 'Status', 'Actions'],
        vendors.map(function (v) {
          return '<tr><td><strong>' + ui.esc(v.name) + '</strong><br><small class="muted">' + ui.esc(v.address || '') + '</small></td>' +
            '<td>' + ui.esc(v.category) + '</td><td>' + ui.esc(v.city || '—') + '</td>' +
            '<td>' + (v.is_kabaza_owned ? '<span class="pill pill--online">KABAZA owned</span>' : '<span class="pill pill--partner">Partner</span>') + '</td>' +
            '<td>' + ui.esc(v.phone || '—') + '</td>' +
            '<td>' + ui.statusPill(v.is_active ? 'online' : 'offline') + '</td>' +
            '<td class="actions-cell"><button class="icon-btn" data-edit-vendor="' + ui.esc(v.id) + '">✎</button>' +
            '<button class="icon-btn icon-btn--danger" data-delete-vendor="' + ui.esc(v.id) + '">×</button></td></tr>';
        }), 'No vendors yet'));

    ui.qs('#add-vendor').addEventListener('click', function () { vendorForm(null, session); });
    ui.on(main(), 'click', '[data-edit-vendor]', async function (e, btn) {
      var v = vendors.filter(function (x) { return x.id === btn.getAttribute('data-edit-vendor'); })[0];
      if (v) vendorForm(v, session);
    });
    ui.on(main(), 'click', '[data-delete-vendor]', async function (e, btn) {
      if (await ui.confirm('Delete vendor?', 'Products linked to this vendor will remain but lose the link.', 'Delete')) {
        await db.deleteVendor(btn.getAttribute('data-delete-vendor'));
        ui.toast('Vendor deleted', 'success');
        vendors(ctx, session);
      }
    });
  }

  async function vendorForm(vendor, session) {
    // Kept separate for clarity; called from vendors() instead of vendorForm.
    var html =
      ui.field('Vendor name', 'name', { value: vendor && vendor.name, required: true }) +
      '<div class="form-grid">' +
        ui.field('Category', 'category', { type: 'select', value: (vendor && vendor.category) || 'general',
          options: ['general', 'food', 'grocery', 'alcohol'] }) +
        ui.field('City', 'city', { value: vendor && vendor.city }) +
      '</div>' +
      ui.field('Address', 'address', { value: vendor && vendor.address }) +
      ui.field('Phone', 'phone', { value: vendor && vendor.phone }) +
      '<div class="check-row"><input type="checkbox" name="is_kabaza_owned" id="kabaza-owned"' +
        ((vendor && vendor.is_kabaza_owned) ? ' checked' : '') + '><label for="kabaza-owned">KABAZA-owned inventory</label></div>' +
      '<div class="check-row"><input type="checkbox" name="is_active" id="vendor-active"' +
        ((!vendor || vendor.is_active) ? ' checked' : '') + '><label for="vendor-active">Active</label></div>';

    return new Promise(function (resolve) {
      var overlay = ui.el('<div class="modal-overlay"><div class="modal" role="dialog">' +
        '<div class="modal__head"><h3>' + (vendor ? 'Edit vendor' : 'New vendor') + '</h3>' +
        '<button class="icon-btn" data-cancel>&times;</button></div>' +
        '<form id="vendor-form"><div class="modal__body">' + html + '</div>' +
        '<div class="modal__foot"><button type="button" class="btn btn--ghost" data-cancel>Cancel</button>' +
        '<button type="submit" class="btn btn--primary">Save</button></div></form></div></div>');
      function close(v) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(v); }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-cancel]')) close(null);
      });
      overlay.addEventListener('submit', async function (e) {
        e.preventDefault();
        var v = ui.formValues(e.target);
        v.is_kabaza_owned = ui.qs('[name="is_kabaza_owned"]', e.target).checked;
        v.is_active = ui.qs('[name="is_active"]', e.target).checked;
        var saved = Object.assign({}, vendor || {}, v);
        if (!saved.id) saved.id = db.uid('vend');
        try {
          await db.saveVendor(saved);
          ui.toast(vendor ? 'Vendor saved' : 'Vendor added', 'success');
          close(saved);
        } catch (err) { ui.toast(err.message || 'Could not save', 'error'); }
      });
      document.body.appendChild(overlay);
    });
  }

  // ------------------------------------------------------------------ orders
  async function orders(ctx, session) {
    var orders = await db.listOrders();
    var riders = await db.listRiders();
    var filter = ctx.query.status || 'all';
    var filtered = filter === 'all' ? orders : orders.filter(function (o) { return o.status === filter; });

    main().innerHTML = page('Orders', 'Track and manage every ride, delivery and shop order.',
      '<div class="select-wrap"><select class="input" id="order-filter">' +
        ['all', 'pending', 'accepted', 'arriving', 'picked_up', 'in_transit', 'completed', 'cancelled'].map(function (s) {
          return '<option value="' + s + '" ' + (filter === s ? 'selected' : '') + '>' +
            (s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')) + '</option>';
        }).join('') + '</select></div>',
      table(['Order', 'Customer', 'Type', 'Status', 'Rider', 'Payment', 'Total', 'Date', ''],
        filtered.map(function (o) {
          var rider = riders.filter(function (r) { return r.id === o.rider_id; })[0];
          return '<tr>' +
            '<td><a href="#/orders/' + ui.esc(o.id) + '"><strong>' + ui.esc((o.id || '').slice(-8)) + '</strong></a>' +
              '<br><small class="muted">' + ui.esc(o.dropoff_address || '') + '</small></td>' +
            '<td>' + ui.esc((o.customer_id || '').slice(0, 12)) + '</td>' +
            '<td>' + ui.esc(o.kind) + '</td>' +
            '<td>' + ui.statusPill(o.status) + '</td>' +
            '<td>' + (rider ? ui.esc(rider.plate_number) : '<button class="link-button" data-assign="' + ui.esc(o.id) + '">Assign</button>') + '</td>' +
            '<td>' + ui.statusPill(o.payment_status) + '</td>' +
            '<td>' + ui.money(o.total) + '</td>' +
            '<td>' + ui.date(o.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</td>' +
            '<td class="actions-cell"><a class="icon-btn" href="#/orders/' + ui.esc(o.id) + '">→</a></td></tr>';
        }), 'No orders found'));

    ui.qs('#order-filter').addEventListener('change', function () {
      router.go('admin/orders?status=' + this.value);
    });

    ui.on(main(), 'click', '[data-assign]', async function (e, btn) {
      var orderId = btn.getAttribute('data-assign');
      var choice = await ui.formModal('Assign a rider',
        ui.field('Rider', 'rider_id', { type: 'select', options: riders.map(function (r) {
          return { value: r.id, label: (r.plate_number || 'Rider') + ' · ' + (r.vehicle_type || '') + (r.is_online ? ' (online)' : '') };
        }) }),
        '<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" data-action="ok">Assign</button>');
      if (!choice || choice.action !== 'ok' || !choice.values.rider_id) return;
      var rider = riders.filter(function (r) { return r.id === choice.values.rider_id; })[0];
      if (!rider) return;
      await db.updateOrder(orderId, { rider_id: rider.id, status: 'accepted' });
      await db.addOrderEvent(orderId, { status: 'accepted', note: 'Assigned by admin: ' + rider.plate_number });
      await db.appendLedger({ entity_type: 'order', entity_id: orderId, event_type: 'assigned',
        payload: { rider_id: rider.id, by_admin: true }, actor_id: session.user.id });
      ui.toast('Rider assigned', 'success');
      orders(ctx, session);
    });
  }

  async function orderDetail(ctx, session) {
    var order = await db.getOrder(ctx.params.id);
    if (!order) { main().innerHTML = ui.empty('Order not found'); return; }
    var events = await db.listOrderEvents(order.id);
    var items = await db.listOrderItems(order.id);
    var riders = await db.listRiders();
    var ledger = await db.listLedger({ entityId: order.id });
    var statuses = ['pending', 'accepted', 'arriving', 'picked_up', 'in_transit', 'completed', 'cancelled'];

    main().innerHTML = page('Order ' + String(order.id).slice(-8), ui.date(order.created_at),
      '<a class="btn btn--ghost" href="#/admin/orders">← All orders</a>',
      '<div class="detail-layout"><div>' +
        ui.card('<div class="detail-status"><h2>' + ui.statusPill(order.status) + ' ' + ui.statusPill(order.payment_status) + '</h2></div>' +
          '<div class="route-detail">' +
            '<div><span class="dot dot--green"></span><div><small>Pickup</small><strong>' + ui.esc(order.pickup_address) + '</strong></div></div>' +
            '<div><span class="dot dot--lime"></span><div><small>Destination</small><strong>' + ui.esc(order.dropoff_address) + '</strong></div></div>' +
          '</div>' +
          '<p class="muted">' + ui.esc(order.notes || '') + '</p>' +
          '<div class="form-grid">' +
            ui.field('Status', 'status', { type: 'select', value: order.status,
              options: statuses.map(function (s) { return { value: s, label: s.replace(/_/g, ' ') }; }) }) +
            ui.field('Rider', 'rider_id', { type: 'select', value: order.rider_id || '',
              options: [{ value: '', label: 'Unassigned' }].concat(riders.map(function (r) {
                return { value: r.id, label: r.plate_number + ' · ' + (r.vehicle_type || '') };
              })) }) +
          '</div>' +
          '<button class="btn btn--primary" id="save-order">Save order</button>') +
        (items.length ? ui.card('<h3>Items</h3>' + items.map(function (i) {
          return '<div class="summary-row"><span>' + ui.esc(i.qty) + '× ' + ui.esc(i.name_snapshot) + '<br>' + ui.sourceBadge(i) + '</span>' +
            '<strong>' + ui.money(i.price * i.qty) + '</strong></div>';
        }).join('') + '<div class="summary-row summary-row--total"><span>Total</span><strong>' + ui.money(order.total) + '</strong></div>') : '') +
        ui.card('<h3>Provenance chain</h3><div class="timeline timeline--compact">' +
          (ledger.length ? ledger.map(function (e) {
            return '<div class="timeline__item"><span class="timeline__dot"></span><div>' +
              '<strong>' + ui.esc(e.event_type.replace(/_/g, ' ')) + '</strong> <small>' + ui.date(e.created_at) + '</small>' +
              '<br><code>' + ui.esc(String(e.hash || '').slice(0, 24)) + '…</code>' +
              (e.anchored_tx ? '<br><small class="success-text">On-chain: ' + ui.esc(e.anchored_tx) + '</small>' : '') +
              '</div></div>';
          }).join('') : '<p class="muted">No entries.</p>') + '</div>') +
      '</div><div>' +
        ui.card('<h3>Totals</h3>' +
          '<div class="summary-row"><span>Subtotal</span><strong>' + ui.money(order.subtotal) + '</strong></div>' +
          '<div class="summary-row"><span>Delivery</span><strong>' + ui.money(order.delivery_fee) + '</strong></div>' +
          '<div class="summary-row summary-row--total"><span>Total</span><strong>' + ui.money(order.total) + '</strong></div>' +
          '<div class="summary-row"><span>Method</span><span>' + ui.esc(order.payment_method) + '</span></div>' +
          '<div class="summary-row"><span>tx_ref</span><code>' + ui.esc(order.tx_ref || '—') + '</code></div>') +
        ui.card('<h3>Timeline</h3><div class="timeline">' + events.map(function (ev) {
          return '<div class="timeline__item"><span class="timeline__dot"></span><div>' +
            '<strong>' + ui.esc(ev.status.replace(/_/g, ' ')) + '</strong>' +
            (ev.note ? '<p class="muted">' + ui.esc(ev.note) + '</p>' : '') +
            '<small>' + ui.date(ev.created_at) + '</small></div></div>';
        }).join('') + '</div>') +
      '</div></div>');

    ui.qs('#save-order').addEventListener('click', async function () {
      var form = ui.qs('.detail-layout form') || ui.qs('.detail-layout');
      var statusEl = ui.qs('[name="status"]', main());
      var riderEl = ui.qs('[name="rider_id"]', main());
      await db.updateOrder(order.id, { status: statusEl.value, rider_id: riderEl.value || null });
      if (statusEl.value !== order.status) {
        await db.addOrderEvent(order.id, { status: statusEl.value, note: 'Updated by admin' });
        await db.appendLedger({ entity_type: 'order', entity_id: order.id, event_type: statusEl.value,
          payload: { by_admin: true }, actor_id: session.user.id });
      }
      ui.toast('Order updated', 'success');
      orderDetail(ctx, session);
    });
  }

  // ------------------------------------------------------------------ riders
  async function riders(ctx, session) {
    var riders = await db.listRiders();
    var users = await db.listUsers();
    main().innerHTML = page('Riders', 'Approve riders and watch who is on the road.',
      '<button class="btn btn--primary" id="add-rider">+ Add rider</button>',
      table(['Rider', 'Vehicle', 'Plate', 'City', 'Status', 'Earnings', 'Rating', 'Actions'],
        riders.map(function (r) {
          var u = users.filter(function (x) { return x.id === r.profile_id; })[0];
          return '<tr><td><strong>' + ui.esc((u && u.full_name) || 'Rider') + '</strong><br>' +
            '<small class="muted">' + ui.esc(r.phone || '') + '</small></td>' +
            '<td>' + ui.esc(r.vehicle_type || '—') + '</td><td>' + ui.esc(r.plate_number || '—') + '</td>' +
            '<td>' + ui.esc(r.city || '—') + '</td>' +
            '<td>' + ui.statusPill(r.is_online ? 'online' : 'offline') + ' ' +
              ui.statusPill(r.is_approved ? 'online' : 'pending_approval') + '</td>' +
            '<td>' + ui.money(r.total_earnings) + '</td>' +
            '<td>★ ' + Number(r.rating || 5).toFixed(1) + '</td>' +
            '<td class="actions-cell"><button class="btn btn--small ' + (r.is_approved ? 'btn--ghost' : 'btn--primary') +
              '" data-approve="' + ui.esc(r.id) + '" data-value="' + (!r.is_approved) + '">' +
              (r.is_approved ? 'Suspend' : 'Approve') + '</button></td></tr>';
        }), 'No riders yet'));

    ui.qs('#add-rider').addEventListener('click', async function () {
      var choice = await ui.formModal('Add rider',
        ui.field('Rider name', 'name', { required: true }) +
        ui.field('Phone', 'phone') +
        '<div class="form-grid">' +
          ui.field('Vehicle type', 'vehicle_type', { value: 'Bajaj Boxer' }) +
          ui.field('Plate number', 'plate_number') +
        '</div>' +
        ui.field('City', 'city', { value: 'Salima' }),
        '<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" data-action="ok">Add</button>');
      if (!choice || choice.action !== 'ok') return;
      var v = choice.values;
      var profile = await db.createProfile({
        full_name: v.name || 'Rider', phone: v.phone || '',
        email: 'rider+' + Date.now() + '@kabaza.mw', role: 'rider', is_active: true
      });
      var profileId = (profile && profile.id) || db.uid('usr');
      await db.saveRider({
        profile_id: profileId, vehicle_type: v.vehicle_type, plate_number: v.plate_number,
        phone: v.phone, city: v.city, is_online: false, is_approved: true,
        lat: -13.9626, lng: 33.7741, heading: 0, rating: 5, total_earnings: 0
      });
      ui.toast('Rider added', 'success');
      riders(ctx, session);
    });

    ui.on(main(), 'click', '[data-approve]', async function (e, btn) {
      var approved = btn.getAttribute('data-value') === 'true';
      await db.updateRider(btn.getAttribute('data-approve'), { is_approved: approved });
      await db.appendLedger({ entity_type: 'rider', entity_id: btn.getAttribute('data-approve'),
        event_type: approved ? 'rider_approved' : 'rider_suspended', payload: {}, actor_id: session.user.id });
      ui.toast(approved ? 'Rider approved' : 'Rider suspended', 'success');
      riders(ctx, session);
    });
  }

  // ------------------------------------------------------------------- users
  async function users(ctx, session) {
    var users = await db.listUsers();
    main().innerHTML = page('Users', 'Manage roles and account access.', '',
      table(['Name', 'Email', 'Phone', 'City', 'Role', 'Status', 'Actions'],
        users.map(function (u) {
          return '<tr><td><strong>' + ui.esc(u.full_name || '—') + '</strong></td>' +
            '<td>' + ui.esc(u.email || '—') + '</td><td>' + ui.esc(u.phone || '—') + '</td>' +
            '<td>' + ui.esc(u.city || '—') + '</td>' +
            '<td><span class="pill pill--' + ui.esc(u.role) + '">' + ui.esc(u.role) + '</span></td>' +
            '<td>' + ui.statusPill(u.is_active ? 'online' : 'offline') + '</td>' +
            '<td class="actions-cell">' +
              (u.id !== session.user.id ? '<button class="btn btn--small btn--ghost" data-role="' + ui.esc(u.id) + '">Change role</button>' : '—') +
            '</td></tr>';
        }), 'No users yet'));

    ui.on(main(), 'click', '[data-role]', async function (e, btn) {
      var id = btn.getAttribute('data-role');
      var u = users.filter(function (x) { return x.id === id; })[0];
      var choice = await ui.formModal('Change role for ' + (u.full_name || 'user'),
        ui.field('Role', 'role', { type: 'select', value: u.role,
          options: ['customer', 'rider', 'admin'] }),
        '<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" data-action="ok">Save</button>');
      if (!choice || choice.action !== 'ok') return;
      await db.updateProfile(id, { role: choice.values.role });
      ui.toast('Role updated', 'success');
      users(ctx, session);
    });
  }

  // ------------------------------------------------------------------- zones
  async function zones(ctx, session) {
    var zones = await db.listZones();
    main().innerHTML = page('Zones & pricing', 'Set service areas and bike fares.',
      '<button class="btn btn--primary" id="add-zone">+ Add zone</button>',
      table(['Zone', 'City', 'Radius', 'Base fare', 'Per km', 'Status', 'Actions'],
        zones.map(function (z) {
          return '<tr><td><strong>' + ui.esc(z.name) + '</strong></td><td>' + ui.esc(z.city) + '</td>' +
            '<td>' + z.radius_km + ' km</td><td>' + ui.money(z.base_fare) + '</td>' +
            '<td>' + ui.money(z.per_km) + '</td>' +
            '<td>' + ui.statusPill(z.is_active ? 'online' : 'offline') + '</td>' +
            '<td class="actions-cell"><button class="icon-btn" data-edit-zone="' + ui.esc(z.id) + '">✎</button></td></tr>';
        }), 'No zones yet'));

    ui.qs('#add-zone').addEventListener('click', function () { zoneForm(null, session); });
    ui.on(main(), 'click', '[data-edit-zone]', async function (e, btn) {
      var z = zones.filter(function (x) { return x.id === btn.getAttribute('data-edit-zone'); })[0];
      if (z) zoneForm(z, session);
    });
  }

  async function zoneForm(zone, session) {
    var html =
      ui.field('Zone name', 'name', { value: zone && zone.name, required: true }) +
      ui.field('City', 'city', { value: (zone && zone.city) || 'Salima' }) +
      '<div class="form-grid">' +
        ui.field('Centre latitude', 'center_lat', { type: 'number', step: '0.0001', value: (zone && zone.center_lat) || -13.9626 }) +
        ui.field('Centre longitude', 'center_lng', { type: 'number', step: '0.0001', value: (zone && zone.center_lng) || 33.7741 }) +
      '</div>' +
      '<div class="form-grid">' +
        ui.field('Radius (km)', 'radius_km', { type: 'number', step: '0.5', value: (zone && zone.radius_km) || 8 }) +
        ui.field('Base fare (MWK)', 'base_fare', { type: 'number', value: (zone && zone.base_fare) || 800 }) +
        ui.field('Per km (MWK)', 'per_km', { type: 'number', value: (zone && zone.per_km) || 300 }) +
      '</div>' +
      '<div class="check-row"><input type="checkbox" name="is_active" id="zone-active"' +
        ((!zone || zone.is_active) ? ' checked' : '') + '><label for="zone-active">Active</label></div>';

    return new Promise(function (resolve) {
      var overlay = ui.el('<div class="modal-overlay"><div class="modal" role="dialog">' +
        '<div class="modal__head"><h3>' + (zone ? 'Edit zone' : 'New zone') + '</h3>' +
        '<button class="icon-btn" data-cancel>&times;</button></div>' +
        '<form id="zone-form"><div class="modal__body">' + html + '</div>' +
        '<div class="modal__foot"><button type="button" class="btn btn--ghost" data-cancel>Cancel</button>' +
        '<button type="submit" class="btn btn--primary">Save</button></div></form></div></div>');
      function close(v) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(v); }
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('[data-cancel]')) close(null);
      });
      overlay.addEventListener('submit', async function (e) {
        e.preventDefault();
        var v = ui.formValues(e.target);
        ['center_lat','center_lng','radius_km','base_fare','per_km'].forEach(function (k) { v[k] = Number(v[k]); });
        v.is_active = ui.qs('[name="is_active"]', e.target).checked;
        var saved = Object.assign({}, zone || {}, v);
        if (!saved.id) saved.id = db.uid('zone');
        await db.saveZone(saved);
        ui.toast('Zone saved', 'success');
        close(saved);
      });
      document.body.appendChild(overlay);
    });
  }

  // ------------------------------------------------------------------ ledger
  async function ledger(ctx, session) {
    var entries = await db.listLedger();
    var valid = entries.every(function (e, i) {
      return i === 0 || e.prev_hash === entries[i - 1].hash;
    });
    main().innerHTML = page('Provenance ledger', 'Append-only audit trail for the KABAZA supply chain.',
      '<div class="pill ' + (valid ? 'pill--online' : 'pill--failed') + '">' +
        (valid ? 'Chain intact' : 'Chain mismatch') + '</div>',
      '<div class="notice notice--info"><strong>Blockchain-ready by design.</strong> Each entry stores a SHA-256 hash of the previous entry plus its own data. ' +
        'The <code>anchored_tx</code> field is reserved for publishing a Merkle root on-chain later — no crypto is used today.</div>' +
      '<div class="ledger-list">' + entries.slice().reverse().map(function (e) {
        return '<div class="ledger-row">' +
          '<span class="ledger-row__seq">#' + e.seq + '</span>' +
          '<div class="ledger-row__main"><strong>' + ui.esc(e.event_type.replace(/_/g, ' ')) + '</strong>' +
            '<small class="muted">' + ui.esc(e.entity_type) + ' · ' + ui.esc(String(e.entity_id).slice(0, 14)) + '</small>' +
            '<code>prev ' + ui.esc(String(e.prev_hash).slice(0, 12)) + '… → hash ' + ui.esc(String(e.hash).slice(0, 12)) + '…</code>' +
          '</div>' +
          '<div class="ledger-row__right"><small>' + ui.date(e.created_at) + '</small>' +
            (e.anchored_tx ? '<span class="pill pill--paid">Anchored</span>' : '<span class="muted">Not anchored</span>') + '</div>' +
        '</div>';
      }).join('') + '</div>');
  }

  // ---------------------------------------------------------------- settings
  async function settings(ctx, session) {
    var settings = await db.getSettings();
    main().innerHTML = page('Settings', 'Operational configuration shown to customers.', '',
      ui.card('<form id="settings-form" class="form-grid">' +
        ui.field('Delivery fee (MWK)', 'delivery_fee', { type: 'number', value: settings.delivery_fee }) +
        ui.field('Free delivery over (MWK)', 'free_delivery_over', { type: 'number', value: settings.free_delivery_over }) +
        ui.field('Support phone', 'support_phone', { value: settings.support_phone }) +
        ui.field('Alcohol notice', 'alcohol_notice', { type: 'textarea', value: settings.alcohol_notice }) +
        ui.field('Pricing note', 'pricing_note', { type: 'textarea', value: settings.pricing_note }) +
        '<div class="form-actions"><button class="btn btn--primary" type="submit">Save settings</button></div>' +
      '</form>') +
      ui.card('<h3>Payment service</h3>' +
        '<p class="muted">Payment API base: <code>' + ui.esc((window.KBZ_CONFIG || {}).paymentApiBase || 'not configured') + '</code></p>' +
        '<p class="fineprint">Set PAYCHANGU_SECRET_KEY and SUPABASE_SERVICE_ROLE_KEY on the server — never in this app.</p>'));

    ui.qs('#settings-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = ui.formValues(e.target);
      for (var key in v) {
        if (!Object.prototype.hasOwnProperty.call(v, key)) continue;
        await db.saveSetting(key, (key === 'delivery_fee' || key === 'free_delivery_over') ? Number(v[key]) : v[key]);
      }
      ui.toast('Settings saved', 'success');
    });
  }

  async function profile(ctx, session) {
    var p = session.profile;
    main().innerHTML = page('Admin profile', 'Your KABAZA operations account.', '',
      ui.card('<div class="profile-head">' + ui.avatar(p.full_name, p.avatar_url, 72) +
        '<div><h2>' + ui.esc(p.full_name) + '</h2><p class="muted">' + ui.esc(p.email || '') + '</p>' +
        '<span class="pill pill--admin">admin</span></div></div>') +
      ui.card('<h3>Details</h3><form id="admin-profile-form" class="form-grid">' +
        ui.field('Full name', 'full_name', { value: p.full_name }) +
        ui.field('Phone', 'phone', { value: p.phone }) +
        '<div class="form-actions"><button class="btn btn--primary" type="submit">Save</button></div></form>'));
    ui.qs('#admin-profile-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var v = ui.formValues(e.target);
      var updated = await db.updateProfile(p.id, v);
      KBZ.app.setSession(Object.assign({}, session, { profile: updated }));
      ui.toast('Saved', 'success');
    });
  }

  KBZ.admin = {
    dashboard: dashboard, products: products, vendors: vendors, orders: orders,
    orderDetail: orderDetail, riders: riders, users: users, zones: zones,
    ledger: ledger, settings: settings, profile: profile
  };
})();
