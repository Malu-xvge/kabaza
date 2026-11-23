# KABAZA — Supabase setup

## 1. Create the project

1. Create a new **free** Supabase project (https://supabase.com → *New project*).
2. Open **SQL Editor** and paste/run `supabase/schema.sql` in full.
3. Then paste/run `supabase/seed.sql` in full. Both files are idempotent and safe to re-run.

## 2. Auth

- **Authentication → Providers**: enable **Email** and **Phone**.
- Phone OTP needs an SMS provider (Twilio) configured under *Authentication → Providers → Phone*; without it, use email sign-in while developing.
- `handle_new_user()` (installed by `schema.sql`) automatically creates a `profiles` row with `role = 'customer'` for every new `auth.users` row, copying `full_name`/`phone` from user metadata.

### First admin

Sign up through the app first, then run this in the SQL Editor (replace the email):

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

## 3. Keys and where they go

**Project Settings → API** gives you the Project URL, anon/publishable key and `service_role` key.

- `www/app/js/config.js` → `supabaseUrl` and `supabaseAnonKey` (`paymentApiBase` points at your `server/` deployment).
- `server/.env` → `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (plus the PayChangu variables from `SPEC.md`).

> Never put the service role key in `www/`, the mobile bundle or a public repo.

## 4. Realtime

`schema.sql` already adds `orders`, `order_events`, `riders` and `ledger_entries` to the `supabase_realtime` publication (idempotently). To verify: **Database → Replication** and make sure those tables are toggled on. Customers subscribe to their own order + events; riders subscribe to pending job offers. Realtime deliveries respect RLS.

## 5. RLS design

All 12 tables have RLS enabled.

| Table | Read | Write |
| --- | --- | --- |
| `profiles` | own row; admins all | own row (cannot self-promote to admin); admins all |
| `riders` | own, online+approved (for customers), admins | own (cannot self-approve), admins |
| `vendors`, `zones`, `products` | active rows public; admins see all | admins only |
| `categories`, `settings` | public config | admins only |
| `orders` | owner, assigned rider, pending offers, admins | customer creates own pending order and may cancel while pending; assigned rider updates; admins all |
| `order_items`, `order_events` | readable when parent order is readable via `can_read_order()` | admins; customer may add items to own pending order; assigned rider may insert order events |
| `payments` | admins and the customer who owns the order | **service role only** (no client write policies) |
| `ledger_entries` | any authenticated user (transparent provenance) | admin-only policy + backend service role via `append_ledger_entry()`; no update/delete policies |

`is_admin()`, `can_read_order()`, `is_order_rider()` and `customer_owns_order()` are `SECURITY DEFINER` with a pinned `search_path`, which prevents policy recursion. The backend uses the service role, which bypasses RLS — keep that key on the server only.

### Source labelling rule

Every product carries `source` + `source_label`:

- `kabaza` → **"In KABAZA stock"** (green badge)
- `partner` → **"Bought from a partner shop"** (amber badge; UI may shorten to "Bought elsewhere")

Admins can toggle these per product. All alcohol has `age_restricted = true`, so the UI must ask for 18+ confirmation when adding to cart and at checkout.

## 6. Provenance ledger (future blockchain ready)

`ledger_entries` is an append-only, hash-chained audit trail. Each row stores `prev_hash` and `hash = sha256(prev_hash | seq | entity_type | entity_id | event_type | canonical_payload)`; genesis uses 64 zeroes. Append through the RPC:

```sql
select public.append_ledger_entry(
  'product',
  '00000000-0000-0000-0000-000000000101',
  'price_set',
  '{"old": 4500, "new": 4800, "currency": "MWK"}'::jsonb,
  auth.uid()
);
```

Writes must go through the backend (service role) or this trusted admin function — normal clients have no INSERT policy. `anchored_tx` / `anchored_at` are reserved for a future on-chain anchoring job; they are NULL today and **no blockchain writes happen in this version**.

## Assumptions

- The spec's `riders` table has no `updated_at`, but the requested `updated_at` trigger needs one, so `riders.updated_at` was added.
- UUID primary keys default to `gen_random_uuid()` and `orders.status` defaults to `'pending'` so client inserts can omit them.
- `categories` and `settings` have no `is_active` column in the spec, so all their rows are publicly readable.
