-- =============================================================================
-- KABAZA — Supabase / Postgres schema
-- Run this in the Supabase SQL Editor BEFORE seed.sql.
-- Money amounts are MWK and are stored as numeric (never floating point).
-- The file is safe to re-run: functions/triggers/policies/views are replaced,
-- and policies/triggers are dropped before being recreated.
--
-- =============================================================================
-- PROVENANCE LEDGER (forward-compatible with blockchain anchoring)
-- -----------------------------------------------------------------------------
-- `ledger_entries` is an append-only, hash-chained audit log for supply-chain
-- events (stocked, sourced, transferred, price_set, order_placed, assigned,
-- picked_up, delivered, paid, verified ...). Every row stores `prev_hash`, the
-- hash of the immediately preceding entry (genesis = 64 zeroes), and `hash`,
-- sha256 of the canonical string
--   prev_hash | seq | entity_type | entity_id | event_type | payload
-- where payload is Postgres' canonical jsonb text (keys ordered by Postgres:
-- shorter keys first, then bytes). Reordering or editing any
-- historical row therefore breaks the chain and is detectable.
--
-- `seq` is a database identity column, so order is monotonic even if rows are
-- inserted concurrently. Use public.append_ledger_entry(...) to append: it
-- serialises writers, resolves the previous hash, computes the digest and
-- inserts the row in one transaction.
--
-- `anchored_tx` and `anchored_at` are RESERVED for a future on-chain anchoring
-- job (e.g. batch Merkle-root publication). NO on-chain writes exist today;
-- these columns are simply null for now, which makes anchoring a drop-in
-- upgrade without a schema migration.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Tables
--    Note: helper functions are defined AFTER the tables, because LANGUAGE sql
--    bodies are parsed at CREATE FUNCTION time and cannot reference a table
--    that does not exist yet.
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'rider', 'admin')),
  full_name text,
  phone text,
  avatar_url text,
  city text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.riders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  vehicle_type text,
  plate_number text,
  phone text,
  city text,
  is_online boolean not null default false,
  is_approved boolean not null default false,
  lat double precision,
  lng double precision,
  heading double precision,
  rating numeric not null default 5,
  total_earnings numeric not null default 0,
  created_at timestamptz not null default now(),
  -- Not in the original spec table listing, added so the requested
  -- updated_at trigger has a column to maintain on this hot table.
  updated_at timestamptz not null default now()
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text check (category in ('food', 'grocery', 'alcohol', 'general')),
  logo_url text,
  address text,
  city text,
  phone text,
  is_active boolean not null default true,
  is_kabaza_owned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  kind text check (kind in ('food', 'grocery', 'alcohol')),
  icon text,
  sort_order integer not null default 0
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references public.vendors(id) on delete set null,
  category_id uuid references public.categories(id) on delete restrict,
  name text not null,
  description text,
  price numeric not null,
  image_url text,
  sku text,
  stock_qty integer not null default 0,
  is_active boolean not null default true,
  source text not null default 'kabaza' check (source in ('kabaza', 'partner')),
  source_label text,
  age_restricted boolean not null default false,
  unit text not null default 'each',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  rider_id uuid references public.riders(id) on delete set null,
  kind text not null check (kind in ('ride', 'delivery', 'shop')),
  -- 'pending' default added for client inserts; RLS also enforces this on insert.
  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'arriving', 'picked_up',
    'in_transit', 'completed', 'cancelled'
  )),
  pickup_address text,
  dropoff_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  distance_km numeric not null default 0,
  subtotal numeric not null default 0,
  delivery_fee numeric not null default 0,
  total numeric not null default 0,
  payment_method text not null default 'paychangu' check (payment_method in ('paychangu', 'cash')),
  payment_status text not null default 'unpaid' check (payment_status in (
    'unpaid', 'pending', 'paid', 'failed', 'refunded'
  )),
  tx_ref text null,
  notes text,
  age_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name_snapshot text,
  price numeric not null default 0,
  qty integer not null default 1,
  source text,
  source_label text
);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text,
  note text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  tx_ref text not null unique,
  amount numeric not null,
  currency text not null default 'MWK',
  provider text not null default 'paychangu',
  status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz null
);

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  center_lat double precision,
  center_lng double precision,
  radius_km numeric,
  base_fare numeric,
  per_km numeric,
  is_active boolean not null default true
);

create table if not exists public.settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- Append-only provenance / supply-chain audit ledger (see header comment).
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  entity_type text,
  entity_id uuid,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text,
  anchored_tx text null,
  anchored_at timestamptz null,
  actor_id uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 0b. Helper functions (defined after tables so LANGUAGE sql bodies resolve)
--     All helpers are SECURITY DEFINER with a pinned search_path. This is what
--     prevents the RLS policies below from recursing into the same table.
-- -----------------------------------------------------------------------------

-- Is the current authenticated user an active admin?
-- Security definer => the profiles lookup is NOT re-checked by the profiles
-- RLS policies that call is_admin(), so there is no infinite recursion.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  );
$$;

-- Single source of truth for reading an order and its children.
-- Customer: own orders. Rider: assigned orders + pending job offers.
-- Admin: everything. Anon (auth.uid() is null): nothing.
create or replace function public.can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and (
        public.is_admin()
        or o.customer_id = auth.uid()
        or exists (
             select 1 from public.riders r
             where r.id = o.rider_id
               and r.profile_id = auth.uid()
           )
        or (
             o.status = 'pending'
             and exists (
               select 1 from public.riders r
               where r.profile_id = auth.uid()
                 and r.is_approved
             )
           )
      )
  );
$$;

-- True when the current user is the rider assigned to this order.
create or replace function public.is_order_rider(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.orders o
    join public.riders r on r.id = o.rider_id
    where o.id = p_order_id
      and r.profile_id = auth.uid()
  );
$$;

-- True when the current user placed this order (used by payments RLS).
create or replace function public.customer_owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.customer_id = auth.uid()
  );
$$;

-- Used by the riders UPDATE policy so a rider cannot approve themselves.
create or replace function public.current_rider_approval(p_rider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.is_approved from public.riders r where r.id = p_rider_id),
    false
  );
$$;

-- Append one hash-chained entry. SECURITY DEFINER so the backend/service role
-- (and trusted admin callers) can append with a single RPC. The write itself
-- bypasses RLS because the function owner is the postgres role. See the header
-- comment for the hash-chain design and future anchoring fields.
create or replace function public.append_ledger_entry(
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns public.ledger_entries
language plpgsql
security definer
-- Supabase installs pgcrypto into the "extensions" schema, so digest() must be
-- reachable here. A missing schema in search_path is harmless on plain Postgres.
set search_path = public, extensions, pg_temp
as $$
declare
  v_prev_hash text;
  v_seq bigint;
  v_hash text;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_row public.ledger_entries;
begin
  -- Admin profiles and the backend service role only. The web app does not
  -- call this RPC directly yet; it is here for the future supply-chain UI.
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'append_ledger_entry: not authorized';
  end if;

  if p_entity_type is null or p_event_type is null then
    raise exception 'append_ledger_entry: entity_type and event_type are required';
  end if;

  -- Serialise appends so concurrent writers cannot fork the hash chain.
  lock table public.ledger_entries in share row exclusive mode;

  select e.hash
    into v_prev_hash
  from public.ledger_entries e
  order by e.seq desc
  limit 1;
  v_prev_hash := coalesce(v_prev_hash, repeat('0', 64));

  -- Consume the identity sequence explicitly so the hash includes the same
  -- seq that is stored in the row.
  select nextval(pg_get_serial_sequence('public.ledger_entries', 'seq')) into v_seq;

  -- jsonb::text is canonical (keys sorted), so every caller hashes identically.
  v_hash := encode(
    digest(
      concat_ws(
        '|', v_prev_hash, v_seq::text, p_entity_type,
        coalesce(p_entity_id::text, '00000000-0000-0000-0000-000000000000'),
        p_event_type, v_payload::text
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.ledger_entries
    (seq, entity_type, entity_id, event_type, payload, prev_hash, hash, actor_id)
  overriding system value
  values
    (v_seq, p_entity_type, p_entity_id, p_event_type, v_payload, v_prev_hash, v_hash, p_actor_id)
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Indexes for the columns the app filters on most
-- -----------------------------------------------------------------------------

create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_rider_id_idx on public.orders (rider_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists products_category_id_idx on public.products (category_id);
create index if not exists products_vendor_id_idx on public.products (vendor_id);
create index if not exists products_active_idx on public.products (is_active);
create index if not exists order_items_order_id_idx on public.order_items (order_id);
create index if not exists order_events_order_id_idx on public.order_events (order_id);
create index if not exists riders_profile_id_idx on public.riders (profile_id);
create index if not exists riders_available_idx on public.riders (is_online, is_approved);
create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists ledger_entries_entity_idx on public.ledger_entries (entity_type, entity_id);
create unique index if not exists ledger_entries_seq_uidx on public.ledger_entries (seq);

-- -----------------------------------------------------------------------------
-- 3. updated_at triggers (products, orders, riders)
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists riders_set_updated_at on public.riders;
create trigger riders_set_updated_at
  before update on public.riders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. New auth user -> profile (role customer)
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role, full_name, phone, avatar_url, city)
  values (
    new.id,
    'customer',
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'KABAZA user'
    ),
    nullif(coalesce(
      new.raw_user_meta_data->>'phone',
      new.raw_user_meta_data->>'phone_number',
      new.phone
    ), ''),
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'city', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only the auth trigger should be able to call this directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles     enable row level security;
alter table public.riders       enable row level security;
alter table public.vendors      enable row level security;
alter table public.categories   enable row level security;
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;
alter table public.order_events enable row level security;
alter table public.payments     enable row level security;
alter table public.zones        enable row level security;
alter table public.settings     enable row level security;
alter table public.ledger_entries enable row level security;

-- Drop only KABAZA policies so this script can be re-run safely.
do $$
declare p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'riders', 'vendors', 'categories', 'products',
        'orders', 'order_items', 'order_events', 'payments', 'zones', 'settings',
        'ledger_entries'
      )
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles -------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.is_admin());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() and not public.is_admin())
  -- A user may switch customer<->rider but can never make themselves admin.
  with check (id = auth.uid() and role <> 'admin');

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- riders ---------------------------------------------------------------------
create policy riders_select_own on public.riders
  for select to authenticated using (profile_id = auth.uid());

create policy riders_select_admin on public.riders
  for select to authenticated using (public.is_admin());

-- RLS cannot hide individual columns; the app must only render name/vehicle/
-- rating/location for this "public" set of online, approved riders.
create policy riders_select_public_online on public.riders
  for select to authenticated using (is_online and is_approved);

create policy riders_insert_own on public.riders
  for insert to authenticated
  with check (profile_id = auth.uid() and coalesce(is_approved, false) = false);

create policy riders_insert_admin on public.riders
  for insert to authenticated with check (public.is_admin());

create policy riders_update_own on public.riders
  for update to authenticated
  using (profile_id = auth.uid())
  -- Cannot self-approve: is_approved must match the stored value.
  with check (profile_id = auth.uid() and coalesce(is_approved, false) = public.current_rider_approval(id));

create policy riders_update_admin on public.riders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy riders_delete_admin on public.riders
  for delete to authenticated using (public.is_admin());

-- vendors / categories / zones / settings ------------------------------------
-- Catalogues and public config are readable; every write is admin-only.
create policy vendors_select_public on public.vendors
  for select using (is_active);
create policy vendors_select_admin on public.vendors
  for select to authenticated using (public.is_admin());
create policy vendors_insert_admin on public.vendors
  for insert to authenticated with check (public.is_admin());
create policy vendors_update_admin on public.vendors
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy vendors_delete_admin on public.vendors
  for delete to authenticated using (public.is_admin());

-- categories has no is_active column in the spec, so all rows are public.
create policy categories_select_public on public.categories
  for select using (true);
create policy categories_insert_admin on public.categories
  for insert to authenticated with check (public.is_admin());
create policy categories_update_admin on public.categories
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy categories_delete_admin on public.categories
  for delete to authenticated using (public.is_admin());

create policy zones_select_public on public.zones
  for select using (is_active);
create policy zones_select_admin on public.zones
  for select to authenticated using (public.is_admin());
create policy zones_insert_admin on public.zones
  for insert to authenticated with check (public.is_admin());
create policy zones_update_admin on public.zones
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy zones_delete_admin on public.zones
  for delete to authenticated using (public.is_admin());

-- settings contains public app config only (no secrets; secrets live on server/.env).
create policy settings_select_public on public.settings
  for select using (true);
create policy settings_insert_admin on public.settings
  for insert to authenticated with check (public.is_admin());
create policy settings_update_admin on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy settings_delete_admin on public.settings
  for delete to authenticated using (public.is_admin());

-- products -------------------------------------------------------------------
create policy products_select_public on public.products
  for select using (is_active);
create policy products_select_admin on public.products
  for select to authenticated using (public.is_admin());
create policy products_insert_admin on public.products
  for insert to authenticated with check (public.is_admin());
create policy products_update_admin on public.products
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_delete_admin on public.products
  for delete to authenticated using (public.is_admin());

-- orders ---------------------------------------------------------------------
create policy orders_select_readable on public.orders
  for select to authenticated using (public.can_read_order(id));

create policy orders_insert_customer on public.orders
  for insert to authenticated
  -- New orders always start pending, unassigned and owned by the caller.
  with check (customer_id = auth.uid() and status = 'pending' and rider_id is null);

create policy orders_update_admin on public.orders
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy orders_update_rider on public.orders
  for update to authenticated
  using (public.is_order_rider(id))
  with check (public.is_order_rider(id));

-- Customer's only allowed mutation is cancelling while the order is still pending.
create policy orders_update_customer_cancel on public.orders
  for update to authenticated
  using (customer_id = auth.uid() and status = 'pending')
  with check (customer_id = auth.uid() and status = 'cancelled');

create policy orders_delete_admin on public.orders
  for delete to authenticated using (public.is_admin());

comment on policy orders_update_customer_cancel on public.orders is
  'Customer may only flip own pending order to cancelled; assigned rider and admin handle all other status changes.';

-- order_items / order_events -------------------------------------------------
create policy order_items_select_readable on public.order_items
  for select to authenticated using (public.can_read_order(order_id));
create policy order_items_insert_admin on public.order_items
  for insert to authenticated with check (public.is_admin());
-- Checkout needs to persist basket lines for the customer's own pending order.
create policy order_items_insert_customer_pending on public.order_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.customer_id = auth.uid()
        and o.status = 'pending'
    )
  );
create policy order_items_update_admin on public.order_items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy order_items_delete_admin on public.order_items
  for delete to authenticated using (public.is_admin());

create policy order_events_select_readable on public.order_events
  for select to authenticated using (public.can_read_order(order_id));
create policy order_events_insert_admin on public.order_events
  for insert to authenticated with check (public.is_admin());
-- Riders post location/status events only on jobs assigned to them.
create policy order_events_insert_rider on public.order_events
  for insert to authenticated with check (public.is_order_rider(order_id));
create policy order_events_update_admin on public.order_events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy order_events_delete_admin on public.order_events
  for delete to authenticated using (public.is_admin());

comment on policy order_events_insert_rider on public.order_events is
  'Assigned riders may append events; reading is governed by can_read_order so pending job offers stay visible.';

-- payments -------------------------------------------------------------------
-- No write policies: all payment rows are written by the server with the
-- service role (which bypasses RLS). Never expose write access to clients.
create policy payments_select_admin on public.payments
  for select to authenticated using (public.is_admin());
create policy payments_select_customer on public.payments
  for select to authenticated using (public.customer_owns_order(order_id));

comment on policy payments_select_customer on public.payments is
  'A payer can see receipts for own orders only; inserts/updates are service-role only.';

-- ledger_entries --------------------------------------------------------------
-- Transparency: any signed-in user may read provenance history.
create policy ledger_entries_select_all on public.ledger_entries
  for select to authenticated using (true);

-- Deliberately NO insert policy for customers/riders, and NO update/delete
-- policy for anyone: the chain is append-only. Backend writes use the service
-- role (which bypasses RLS); trusted admin writes go through the
-- public.append_ledger_entry() security-definer function.
create policy ledger_entries_insert_admin on public.ledger_entries
  for insert to authenticated with check (public.is_admin());

comment on policy ledger_entries_insert_admin on public.ledger_entries is
  'Admin-only append path; normal clients have no INSERT policy. Service role bypasses RLS, all writers should use append_ledger_entry().';

-- -----------------------------------------------------------------------------
-- 6. Grants (RLS still decides which rows are visible)
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.can_read_order(uuid) to anon, authenticated, service_role;
grant execute on function public.is_order_rider(uuid) to anon, authenticated, service_role;
grant execute on function public.customer_owns_order(uuid) to anon, authenticated, service_role;
grant execute on function public.current_rider_approval(uuid) to anon, authenticated, service_role;
grant execute on function public.set_updated_at() to service_role;

-- Ledger appends: revoke PUBLIC/anon, grant only to authenticated (the function
-- itself rejects anyone who is not an active admin) and to the backend service
-- role. The web app does not call this RPC directly yet.
revoke all on function public.append_ledger_entry(text, uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.append_ledger_entry(text, uuid, text, jsonb, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Helpful view
--    Views run with the owner's rights by default, so this one applies an
--    explicit can_read_order() filter instead of relying on orders RLS.
-- -----------------------------------------------------------------------------

create or replace view public.order_summary as
select
  o.id,
  o.customer_id,
  c.full_name as customer_name,
  c.phone as customer_phone,
  o.rider_id,
  r.profile_id as rider_profile_id,
  rp.full_name as rider_name,
  o.kind,
  o.status,
  o.pickup_address,
  o.dropoff_address,
  o.distance_km,
  o.subtotal,
  o.delivery_fee,
  o.total,
  o.payment_method,
  o.payment_status,
  o.created_at,
  o.updated_at
from public.orders o
left join public.profiles c on c.id = o.customer_id
left join public.riders r on r.id = o.rider_id
left join public.profiles rp on rp.id = r.profile_id
where public.can_read_order(o.id);

grant select on public.order_summary to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Realtime publication (idempotent)
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach t in array array['orders', 'order_events', 'riders', 'ledger_entries'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Full old rows in UPDATE/DELETE events so realtime clients get useful payloads.
alter table public.orders          replica identity full;
alter table public.order_events    replica identity full;
alter table public.riders          replica identity full;
alter table public.ledger_entries  replica identity full;
