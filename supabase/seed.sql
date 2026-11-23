-- =============================================================================
-- KABAZA — seed data (Malawi, MWK)
-- Run AFTER schema.sql. All ids are fixed/readable and every insert is
-- idempotent, so this file can be re-run without duplicating data.
-- =============================================================================

-- Zones ----------------------------------------------------------------------
insert into public.zones (id, name, city, center_lat, center_lng, radius_km, base_fare, per_km, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'Lilongwe City Centre',   'Lilongwe', -13.9626, 33.7741, 3.0, 800, 300, true),
  ('00000000-0000-0000-0000-000000000002', 'Kanengo',                'Lilongwe', -13.9550, 33.7850, 4.0, 800, 300, true),
  ('00000000-0000-0000-0000-000000000003', 'Area 25',                'Lilongwe', -13.9740, 33.7600, 2.5, 800, 300, true),
  ('00000000-0000-0000-0000-000000000004', 'Blantyre City Centre',   'Blantyre', -15.7873, 35.0130, 3.0, 800, 300, true),
  ('00000000-0000-0000-0000-000000000005', 'Limbe',                  'Blantyre', -15.7960, 35.0450, 3.0, 800, 300, true)
on conflict (id) do nothing;

-- Categories -----------------------------------------------------------------
insert into public.categories (id, name, slug, kind, icon, sort_order) values
  ('00000000-0000-0000-0000-000000000010', 'Food',      'food',      'food',    '🍛', 1),
  ('00000000-0000-0000-0000-000000000011', 'Groceries', 'groceries', 'grocery', '🛒', 2),
  ('00000000-0000-0000-0000-000000000012', 'Alcohol',   'alcohol',   'alcohol', '🍺', 3),
  ('00000000-0000-0000-0000-000000000013', 'Drinks',    'drinks',    'food',    '🥤', 4),
  ('00000000-0000-0000-0000-000000000014', 'Snacks',    'snacks',    'food',    '🍿', 5)
on conflict (id) do nothing;

-- Vendors --------------------------------------------------------------------
insert into public.vendors (id, name, category, logo_url, address, city, phone, is_active, is_kabaza_owned) values
  ('00000000-0000-0000-0000-000000000020', 'KABAZA Kitchen',        'food',    '/app/assets/vendor.svg', 'City Centre',        'Lilongwe', '+265 888 100 201', true,  true),
  ('00000000-0000-0000-0000-000000000021', 'KABAZA Mart',           'grocery', '/app/assets/vendor.svg', 'Kamuzu Central Hospital Road', 'Lilongwe', '+265 888 100 202', true,  true),
  ('00000000-0000-0000-0000-000000000022', 'KABAZA Drinks & Spirits','alcohol', '/app/assets/vendor.svg', 'City Centre',        'Lilongwe', '+265 888 100 203', true,  true),
  ('00000000-0000-0000-0000-000000000023', 'Shoprite Lilongwe',     'grocery', '/app/assets/vendor.svg', 'Kanengo Industrial Area', 'Lilongwe', '+265 888 200 301', true,  false),
  ('00000000-0000-0000-0000-000000000024', 'Blantyre Corner Store', 'general', '/app/assets/vendor.svg', 'Haile Selassie Avenue', 'Blantyre', '+265 888 200 401', true,  false),
  ('00000000-0000-0000-0000-000000000025', 'Limbe Fresh Market',    'food',    '/app/assets/vendor.svg', 'Limbe Market',       'Blantyre', '+265 888 200 402', true,  false)
on conflict (id) do nothing;

-- Products (prices in MWK) ----------------------------------------------------
-- source = 'kabaza'  -> source_label 'In KABAZA stock'
-- source = 'partner' -> source_label 'Bought from a partner shop'
-- Every alcohol item has age_restricted = true.
insert into public.products
  (id, vendor_id, category_id, name, description, price, image_url, sku, stock_qty, is_active, source, source_label, age_restricted, unit)
values
  -- Food / prepared meals ----------------------------------------------------
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Nsima & Beef Stew', 'Nsima with a rich Malawian beef stew.', 4500, '/app/assets/product.svg', 'KBZ-FD-001', 40, true, 'kabaza', 'In KABAZA stock', false, 'plate'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Nsima & Chicken Stew', 'Nsima served with chicken and tomato stew.', 5000, '/app/assets/product.svg', 'KBZ-FD-002', 30, true, 'kabaza', 'In KABAZA stock', false, 'plate'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Plain Nsima Portion', 'A warm portion of white maize nsima.', 1800, '/app/assets/product.svg', 'KBZ-FD-003', 80, true, 'kabaza', 'In KABAZA stock', false, 'portion'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Grilled Chicken (Whole)', 'Whole chicken grilled with local spices.', 9500, '/app/assets/product.svg', 'KBZ-FD-004', 12, true, 'kabaza', 'In KABAZA stock', false, 'each'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Mandasi (6 pcs)', 'Six golden mandasi, best with tea.', 1500, '/app/assets/product.svg', 'KBZ-FD-005', 60, true, 'kabaza', 'In KABAZA stock', false, 'pack'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Bean Stew & Rice', 'Beans cooked in coconut with steamed rice.', 3500, '/app/assets/product.svg', 'KBZ-FD-006', 35, true, 'kabaza', 'In KABAZA stock', false, 'plate'),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000010', 'Chicken & Chips', 'Grilled chickenpieces with chips from Limbe Fresh Market.', 6500, '/app/assets/product.svg', 'PTN-FD-001', 20, true, 'partner', 'Bought from a partner shop', false, 'plate'),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Samosa (4 pcs)', 'Four spicy meat samosas.', 1800, '/app/assets/product.svg', 'KBZ-FD-007', 50, true, 'kabaza', 'In KABAZA stock', false, 'pack'),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000010', 'Fried Cassava Chips', 'Crisp fried cassava from the market.', 2000, '/app/assets/product.svg', 'PTN-FD-002', 25, true, 'partner', 'Bought from a partner shop', false, 'portion'),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000010', 'Roasted Maize (1 cob)', 'Freshly roasted maize on the cob.', 1200, '/app/assets/product.svg', 'PTN-FD-003', 40, true, 'partner', 'Bought from a partner shop', false, 'each'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000025', '00000000-0000-0000-0000-000000000010', 'Beef Skewer (2 sticks)', 'Two grilled beef skewers with pepper.', 3000, '/app/assets/product.svg', 'PTN-FD-004', 30, true, 'partner', 'Bought from a partner shop', false, 'pack'),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Sweet Potato Fries', 'Crispy sweet potato fries with salt.', 2200, '/app/assets/product.svg', 'KBZ-FD-008', 35, true, 'kabaza', 'In KABAZA stock', false, 'portion'),

  -- Groceries ----------------------------------------------------------------
  ('00000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Maize Flour (2 kg)', 'Fine white maize flour for nsima.', 3200, '/app/assets/product.svg', 'KBZ-GR-001', 100, true, 'kabaza', 'In KABAZA stock', false, 'bag'),
  ('00000000-0000-0000-0000-000000000114', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Sugar (1 kg)', 'Refined white sugar.', 2100, '/app/assets/product.svg', 'KBZ-GR-002', 120, true, 'kabaza', 'In KABAZA stock', false, 'packet'),
  ('00000000-0000-0000-0000-000000000115', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Cooking Oil (1 L)', 'Vegetable cooking oil.', 3800, '/app/assets/product.svg', 'KBZ-GR-003', 80, true, 'kabaza', 'In KABAZA stock', false, 'bottle'),
  ('00000000-0000-0000-0000-000000000116', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Rice (2 kg)', 'Long grain parboiled rice.', 4200, '/app/assets/product.svg', 'KBZ-GR-004', 70, true, 'kabaza', 'In KABAZA stock', false, 'bag'),
  ('00000000-0000-0000-0000-000000000117', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Beans (1 kg)', 'Dry red beans, sorted and cleaned.', 3600, '/app/assets/product.svg', 'KBZ-GR-005', 65, true, 'kabaza', 'In KABAZA stock', false, 'packet'),
  ('00000000-0000-0000-0000-000000000118', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Tea Bags (25s)', 'Black tea, 25 bags per pack.', 1900, '/app/assets/product.svg', 'KBZ-GR-006', 90, true, 'kabaza', 'In KABAZA stock', false, 'pack'),
  ('00000000-0000-0000-0000-000000000119', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Bread (Loaf)', 'Fresh brown bread loaf.', 1800, '/app/assets/product.svg', 'KBZ-GR-007', 50, true, 'kabaza', 'In KABAZA stock', false, 'loaf'),
  ('00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Eggs (6 pcs)', 'Six fresh chicken eggs.', 2400, '/app/assets/product.svg', 'KBZ-GR-008', 60, true, 'kabaza', 'In KABAZA stock', false, 'tray'),
  ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Salt (500 g)', 'Iodised table salt.', 700, '/app/assets/product.svg', 'KBZ-GR-009', 150, true, 'kabaza', 'In KABAZA stock', false, 'packet'),
  ('00000000-0000-0000-0000-000000000122', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Tomatoes (1 kg)', 'Ripe local tomatoes.', 1600, '/app/assets/product.svg', 'KBZ-GR-010', 80, true, 'kabaza', 'In KABAZA stock', false, 'kg'),
  ('00000000-0000-0000-0000-000000000123', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Onions (1 kg)', 'Locally grown red onions.', 1500, '/app/assets/product.svg', 'KBZ-GR-011', 80, true, 'kabaza', 'In KABAZA stock', false, 'kg'),
  ('00000000-0000-0000-0000-000000000124', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000011', 'Chicken (Whole, Raw)', 'Whole raw chicken from our partner shop.', 7800, '/app/assets/product.svg', 'PTN-GR-001', 25, true, 'partner', 'Bought from a partner shop', false, 'each'),
  ('00000000-0000-0000-0000-000000000125', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000011', 'Maize Flour (5 kg)', 'Family pack of white maize flour.', 7500, '/app/assets/product.svg', 'PTN-GR-002', 40, true, 'partner', 'Bought from a partner shop', false, 'bag'),
  ('00000000-0000-0000-0000-000000000126', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000011', 'Cooking Oil (2 L)', 'Two-litre bottle of vegetable oil.', 7200, '/app/assets/product.svg', 'PTN-GR-003', 35, true, 'partner', 'Bought from a partner shop', false, 'bottle'),

  -- Alcohol (18+ only) --------------------------------------------------------
  ('00000000-0000-0000-0000-000000000127', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Chibuku Shake Shake', 'Traditional opaque beer, shake before opening. 18+', 1500, '/app/assets/product.svg', 'KBZ-AL-001', 100, true, 'kabaza', 'In KABAZA stock', true, 'each'),
  ('00000000-0000-0000-0000-000000000128', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Carlsberg Lager', 'Carlsberg lager 330 ml. 18+', 2600, '/app/assets/product.svg', 'KBZ-AL-002', 72, true, 'kabaza', 'In KABAZA stock', true, 'bottle'),
  ('00000000-0000-0000-0000-000000000129', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Castle Lager', 'Castle lager 330 ml. 18+', 2600, '/app/assets/product.svg', 'KBZ-AL-003', 72, true, 'kabaza', 'In KABAZA stock', true, 'bottle'),
  ('00000000-0000-0000-0000-000000000130', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Malawi Gin', 'Malawi Gin 750 ml bottle. 18+', 8500, '/app/assets/product.svg', 'KBZ-AL-004', 24, true, 'kabaza', 'In KABAZA stock', true, 'bottle'),
  ('00000000-0000-0000-0000-000000000131', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Kuche Kuche', 'Kuche Kuche flavoured beer 330 ml. 18+', 2200, '/app/assets/product.svg', 'KBZ-AL-005', 60, true, 'kabaza', 'In KABAZA stock', true, 'bottle'),
  ('00000000-0000-0000-0000-000000000132', '00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000012', 'Mosi Lager', 'Mosi lager 330 ml. 18+', 2500, '/app/assets/product.svg', 'KBZ-AL-006', 60, true, 'kabaza', 'In KABAZA stock', true, 'bottle'),
  ('00000000-0000-0000-0000-000000000133', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000012', 'Mtika', 'Mtika traditional beer 500 ml. 18+', 1800, '/app/assets/product.svg', 'PTN-AL-001', 48, true, 'partner', 'Bought from a partner shop', true, 'bottle'),
  ('00000000-0000-0000-0000-000000000134', '00000000-0000-0000-0000-000000000024', '00000000-0000-0000-0000-000000000012', 'Chibuku Special', 'Chibuku Special 500 ml. 18+', 2000, '/app/assets/product.svg', 'PTN-AL-002', 48, true, 'partner', 'Bought from a partner shop', true, 'bottle'),

  -- Soft drinks ---------------------------------------------------------------
  ('00000000-0000-0000-0000-000000000135', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000013', 'Coca-Cola (500 ml)', 'Chilled Coca-Cola 500 ml.', 1400, '/app/assets/product.svg', 'KBZ-DR-001', 120, true, 'kabaza', 'In KABAZA stock', false, 'bottle'),
  ('00000000-0000-0000-0000-000000000136', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000013', 'Fanta (500 ml)', 'Chilled Fanta orange 500 ml.', 1400, '/app/assets/product.svg', 'KBZ-DR-002', 100, true, 'kabaza', 'In KABAZA stock', false, 'bottle'),
  ('00000000-0000-0000-0000-000000000137', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000013', 'Thobwa (1 L)', 'Traditional sweetened maize drink, non-alcoholic.', 1500, '/app/assets/product.svg', 'KBZ-DR-003', 30, true, 'kabaza', 'In KABAZA stock', false, 'litre'),

  -- Snacks --------------------------------------------------------------------
  ('00000000-0000-0000-0000-000000000138', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000014', 'Potato Chips (50 g)', 'Salted potato chips.', 1200, '/app/assets/product.svg', 'KBZ-SN-001', 100, true, 'kabaza', 'In KABAZA stock', false, 'pack'),
  ('00000000-0000-0000-0000-000000000139', '00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000014', 'Peanuts (200 g)', 'Roasted peanuts from our partner shop.', 1000, '/app/assets/product.svg', 'PTN-SN-001', 80, true, 'partner', 'Bought from a partner shop', false, 'pack'),
  ('00000000-0000-0000-0000-000000000140', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000014', 'Biscuits (Pack)', 'Cream crackers, 200 g pack.', 1300, '/app/assets/product.svg', 'KBZ-SN-002', 90, true, 'kabaza', 'In KABAZA stock', false, 'pack')
on conflict (id) do nothing;

-- Settings (public app configuration; no secrets here) ------------------------
insert into public.settings (key, value) values
  ('pricing', '{
      "currency": "MWK",
      "baseFare": 800,
      "perKm": 300,
      "minimumFare": 800,
      "deliveryBase": 500,
      "deliveryPerKm": 200,
      "surgeMultiplier": 1,
      "priceUnit": "MWK per km"
    }'::jsonb),
  ('app', '{
      "appName": "KABAZA",
      "supportPhone": "+265 888 100 100",
      "city": "Lilongwe",
      "version": "1.0.0",
      "minAge": 18,
      "demoMode": true
    }'::jsonb),
  ('alcohol_notice', '{
      "title": "18+ only",
      "message": "Alcohol can only be ordered by persons aged 18 or above. We will ask you to confirm your age when adding alcohol to your basket and again at checkout. A valid ID may be requested on delivery.",
      "confirmLabel": "I confirm I am 18 or older",
      "declineLabel": "I am under 18"
    }'::jsonb),
  ('delivery_fee_rules', '{
      "currency": "MWK",
      "baseFee": 500,
      "perKm": 200,
      "freeDeliveryAbove": 20000,
      "maxDistanceKm": 25,
      "longDistanceFeePerKm": 350,
      "sameDaySurcharge": 0,
      "notes": "Fee = baseFee + perKm * distance; waived when subtotal reaches freeDeliveryAbove."
    }'::jsonb),
  ('payment', '{
      "provider": "paychangu",
      "currency": "MWK",
      "enabled": true,
      "methods": ["paychangu", "cash"],
      "txRefPrefix": "kbz_"
    }'::jsonb),
  ('shop', '{
      "currency": "MWK",
      "minimumOrder": 1000,
      "sourceLabels": {
        "kabaza": "In KABAZA stock",
        "partner": "Bought from a partner shop"
      },
      "ageVerifiedRequiredForAlcohol": true
    }'::jsonb)
on conflict (key) do nothing;

-- Provenance ledger (example hash chain) --------------------------------------
-- These three rows demonstrate a valid chain. Each `hash` is
-- sha256(prev_hash | seq | entity_type | entity_id | event_type | payload)
-- using Postgres' canonical jsonb payload text, exactly as computed by
-- public.append_ledger_entry(). Genesis uses 64 zeroes as prev_hash.
-- anchored_tx / anchored_at are intentionally NULL (future on-chain anchoring).
insert into public.ledger_entries
  (id, seq, entity_type, entity_id, event_type, payload, prev_hash, hash, anchored_tx, anchored_at, actor_id)
overriding system value
values
  (
    '00000000-0000-0000-0000-000000000900', 1, 'ledger',
    '00000000-0000-0000-0000-000000000000', 'genesis',
    '{"note": "KABAZA provenance ledger genesis", "chain": "kabaza-provenance-v1", "network": "supabase-postgres"}'::jsonb,
    '0000000000000000000000000000000000000000000000000000000000000000',
    '3a9aea03162f745efdaa0ddafa67242e69dde01c3b9644b7a528cfe4cb9f16c8',
    null, null, null
  ),
  (
    '00000000-0000-0000-0000-000000000901', 2, 'product',
    '00000000-0000-0000-0000-000000000101', 'stocked',
    '{"sku": "KBZ-FD-001", "source": "kabaza", "vendor": "KABAZA Kitchen", "stock_qty": 40}'::jsonb,
    '3a9aea03162f745efdaa0ddafa67242e69dde01c3b9644b7a528cfe4cb9f16c8',
    '3eae9276dc9b5c1c461b5f29585ce3e4fdf0c93dccb0e6c276bd07c5e1f5f9ec',
    null, null, null
  ),
  (
    '00000000-0000-0000-0000-000000000902', 3, 'product',
    '00000000-0000-0000-0000-000000000124', 'sourced',
    '{"sku": "PTN-GR-001", "source": "partner", "vendor": "Shoprite Lilongwe", "source_label": "Bought from a partner shop"}'::jsonb,
    '3eae9276dc9b5c1c461b5f29585ce3e4fdf0c93dccb0e6c276bd07c5e1f5f9ec',
    '3eed5b920a5f0229986068373c1722a24dc1f4d95d0c93004cdc5a66e23ee28c',
    null, null, null
  )
on conflict (id) do nothing;

-- Explicit seq values do not advance an identity sequence; move it past the
-- seeded rows so append_ledger_entry() continues at seq 4 without a collision.
select setval(
  pg_get_serial_sequence('public.ledger_entries', 'seq'),
  greatest(3, (select coalesce(max(seq), 0) from public.ledger_entries)),
  true
);
