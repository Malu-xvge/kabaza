# KABAZA — shared build spec

KABAZA is a Malawi-based bike-hailing, delivery and on-demand commerce platform.
One web codebase (`www/`) serves three things:

1. `www/index.html` — public marketing site (root on GitHub Pages).
   Inside Capacitor it immediately redirects to `app/index.html`.
2. `www/app/index.html` — the full web app (customer / rider / admin).
3. `android/` — Capacitor native wrapper producing the APK, like GameNight.

Backend: `server/` — Express service holding PayChangu secret + Supabase service role key.
Database: fresh Supabase project (schema in `supabase/schema.sql`, seed in `supabase/seed.sql`).

## Money and identity

- Currency: MWK (Malawi Kwacha). Never trust prices from the client.
- Auth: Supabase Auth. `profiles.role` is one of `customer`, `rider`, `admin`.
- All DB access through Supabase client with RLS. Service role only on `server/`.

## Data model (exact names used by the web app)

### `profiles`
`id uuid PK -> auth.users`, `role text` (customer|rider|admin), `full_name text`,
`phone text`, `avatar_url text`, `city text`, `is_active boolean default true`,
`created_at timestamptz default now()`

### `riders`
`id uuid PK default gen_random_uuid()`, `profile_id uuid -> profiles`,
`vehicle_type text`, `plate_number text`, `phone text`, `city text`,
`is_online boolean default false`, `is_approved boolean default false`,
`lat double precision`, `lng double precision`, `heading double precision`,
`rating numeric default 5`, `total_earnings numeric default 0`,
`created_at timestamptz default now()`

### `vendors`
`id uuid PK`, `name text`, `category text` (food|grocery|alcohol|general),
`logo_url text`, `address text`, `city text`, `phone text`,
`is_active boolean default true`,
`is_kabaza_owned boolean default false` (true = stocked by us, false = bought elsewhere),
`created_at timestamptz default now()`

### `categories`
`id uuid PK`, `name text`, `slug text unique`, `kind text` (food|grocery|alcohol),
`icon text`, `sort_order int default 0`

### `products`
`id uuid PK`, `vendor_id uuid -> vendors null`, `category_id uuid -> categories`,
`name text`, `description text`, `price numeric`, `image_url text`, `sku text`,
`stock_qty int default 0`, `is_active boolean default true`,
`source text default 'kabaza'` (**'kabaza'** = stocked by Kabaza, **'partner'** = bought elsewhere),
`source_label text` (e.g. "Sold by KabaZa", "Bought from a partner shop"),
`age_restricted boolean default false`, `unit text default 'each'`,
`created_at timestamptz default now()`, `updated_at timestamptz default now()`

### `orders`
`id uuid PK`, `customer_id uuid -> profiles`, `rider_id uuid -> riders null`,
`kind text` (**ride**|**delivery**|**shop**), `status text`
(pending|accepted|arriving|picked_up|in_transit|completed|cancelled),
`pickup_address text`, `dropoff_address text`, `pickup_lat double precision`,
`pickup_lng double precision`, `dropoff_lat double precision`,
`dropoff_lng double precision`, `distance_km numeric default 0`,
`subtotal numeric default 0`, `delivery_fee numeric default 0`, `total numeric default 0`,
`payment_method text default 'paychangu'` (paychangu|cash),
`payment_status text default 'unpaid'` (unpaid|pending|paid|failed|refunded),
`tx_ref text null`, `notes text`, `age_verified boolean default false`,
`created_at timestamptz default now()`, `updated_at timestamptz default now()`

### `order_items`
`id uuid PK`, `order_id uuid -> orders on delete cascade`, `product_id uuid -> products null`,
`name_snapshot text`, `price numeric`, `qty int`, `source text`, `source_label text`

### `order_events`
`id uuid PK`, `order_id uuid -> orders on delete cascade`, `status text`,
`note text`, `lat double precision`, `lng double precision`,
`created_at timestamptz default now()`

### `payments`
`id uuid PK`, `order_id uuid -> orders`, `tx_ref text unique`, `amount numeric`,
`currency text default 'MWK'`, `provider text default 'paychangu'`,
`status text`, `raw jsonb`, `created_at timestamptz default now()`,
`verified_at timestamptz null`

### `zones`
`id uuid PK`, `name text`, `city text`, `center_lat double precision`,
`center_lng double precision`, `radius_km numeric`, `base_fare numeric`,
`per_km numeric`, `is_active boolean default true`

### `settings`
`key text PK`, `value jsonb`, `updated_at timestamptz default now()`

### `ledger_entries` (supply-chain provenance, future blockchain-ready)
Append-only hash chain. `id uuid PK`, `seq bigint identity unique`,
`entity_type text`, `entity_id uuid`, `event_type text`, `payload jsonb`,
`prev_hash text`, `hash text`, `anchored_tx text null`, `anchored_at timestamptz null`,
`actor_id uuid null`, `created_at timestamptz`.
- `hash = sha256(prev_hash + seq + entity_type + entity_id + event_type + payload)`
- `anchored_tx` / `anchored_at` are reserved for future on-chain anchoring. No chain writes now.
- Writes go through the backend / `append_ledger_entry()` SQL function, never direct client inserts.
- The UI shows a "Provenance" timeline from this table on order/product detail.

## Realtime

Enable realtime publication for `orders`, `order_events`, `riders`.
Riders subscribe to pending orders; customers subscribe to their order + events.

## Payment backend contract (`server/`)

Built from GameNight's PayChangu service, adapted to orders.

- `GET /health` → `{ ok, configured, currency }`
- `POST /api/payment/initiate` `{ orderId }`
  - Uses Supabase **service role** to load the order. Computes amount from DB,
    never from the request. Rejects already-paid orders.
  - Creates `kbz_<orderid-stub>_<nonce>` tx_ref, calls PayChangu `/payment`.
  - Writes `payments` row (status pending) and updates `orders.tx_ref`,
    `orders.payment_status='pending'`.
  - Returns `{ txRef, checkoutUrl, amount, orderId }`.
- `GET /api/payment/verify/:txRef`
  - Calls PayChangu `/verify-payment/:txRef`. Success only when status=success,
    currency=MWK, tx_ref matches and paid amount >= DB amount.
  - On success writes payment row + `orders.payment_status='paid'`.
  - Returns `{ status, orderId, amount, currency }`.
- `POST /api/payment/callback` — IPN. Log it, acknowledge fast, never trust alone.
- `GET /payment/return` — "return to KABAZA" page.
- `GET /api/config` — public config (payments enabled, currency).
- Local mock provider (`server/mock-provider.js`) on port 8788, same as GameNight.

Env (`.env.example`, never commit real `.env`):
`PAYCHANGU_SECRET_KEY`, `PAYCHANGU_API_BASE`, `BASE_URL`, `PORT`, `ALLOWED_ORIGINS`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Frontend public config (`www/app/js/config.js`)

```js
window.KBZ_CONFIG = {
  supabaseUrl: '',       // fill with fresh project URL
  supabaseAnonKey: '',   // fill with publishable/anon key
  paymentApiBase: '',    // e.g. https://kabaza-payments.onrender.com
  paymentsEnabled: false,
  currency: 'MWK',
  appName: 'KABAZA'
};
```

Demo mode: when `supabaseUrl` is empty, `db.js` uses localStorage-backed demo
data so the whole UI can be clicked and tested before credentials exist.

## Source labelling rule

Every product has `source` + `source_label`. The UI shows a small badge:
- `kabaza` → "In KABAZA stock" (green)
- `partner` → "Bought elsewhere" (amber)

Admin can toggle this per product. This satisfies the "show items bought elsewhere
with a label" requirement while keeping the label configurable.

## Alcohol rules

- Products with `age_restricted=true` (all alcohol) require an 18+ confirmation
  before being added to cart and again at checkout.
- Marketing page carries an 18+ notice.

## Roles / routes (hash router)

- `#/home`, `#/ride`, `#/delivery`, `#/shop`, `#/shop/:category`, `#/cart`,
  `#/checkout`, `#/orders`, `#/orders/:id`, `#/profile`, `#/login`
- `#/rider` (online toggle, jobs, active job, earnings)
- `#/admin` (dashboard, products, vendors, orders, riders, users, zones, settings)

## GitHub

- New repo `Malu-xvge/kabaza` (public, for GitHub Pages at `/kabaza/`).
- Local working copy: `C:\Users\R6-S8\Documents\Default Project\kabaza`.
