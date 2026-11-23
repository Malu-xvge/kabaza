-- =============================================================================
-- KABAZA — phone-first passenger registration (Salima launch)
-- Run in the Supabase SQL editor AFTER schema.sql and seed.sql.
--
-- Nothing here gives the browser access to OTP codes or challenges. The table
-- has RLS enabled with NO policies, so only the backend service role can read
-- or write it. Codes are stored as salted SHA-256 hashes, never as plain text.
-- =============================================================================

-- 1. Extend profiles with verification metadata --------------------------------
alter table public.profiles add column if not exists phone_e164 text;
alter table public.profiles add column if not exists phone_verified_at timestamptz;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists registration_channel text not null default 'email';

-- Populate a canonical +265 key from legacy free-text phone values.
update public.profiles
set phone_e164 = case
  when phone is null or btrim(phone) = '' then null
  when btrim(phone) like '+265%' then '+265' || nullif(regexp_replace(substring(btrim(phone) from 5), '\D', '', 'g'), '')
  when btrim(phone) like '265%'  then '+265' || nullif(regexp_replace(substring(btrim(phone) from 4), '\D', '', 'g'), '')
  when btrim(phone) like '0%'    then '+265' || nullif(regexp_replace(substring(btrim(phone) from 2), '\D', '', 'g'), '')
  else '+265' || nullif(regexp_replace(btrim(phone), '\D', '', 'g'), '')
end
where phone_e164 is null;

-- Only keep the oldest row for any number that was duplicated in legacy data.
update public.profiles p
set phone_e164 = null
from public.profiles q
where q.phone_e164 = p.phone_e164
  and q.phone_e164 is not null
  and (q.created_at, q.id) < (p.created_at, p.id);

create unique index if not exists profiles_phone_e164_unique
  on public.profiles (phone_e164) where phone_e164 is not null;

-- 2. OTP challenges ------------------------------------------------------------
create table if not exists public.phone_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  purpose text not null check (purpose in ('register', 'reset')),
  code_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  token_used_at timestamptz,
  last_sent_at timestamptz not null default now(),
  resend_count integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists phone_otp_lookup_idx
  on public.phone_otp_challenges (phone_e164, purpose, created_at desc);
create index if not exists phone_otp_rate_idx
  on public.phone_otp_challenges (phone_e164, created_at desc);

alter table public.phone_otp_challenges enable row level security;
-- Deliberately NO policies: anon/authenticated cannot see a single row.
revoke all on public.phone_otp_challenges from anon, authenticated;
-- The backend service role bypasses RLS, but it still needs table privileges.
grant select, insert, update, delete on public.phone_otp_challenges to service_role;

-- Keep the table tidy. The backend only needs recent challenges for rate limits.
create or replace function public.cleanup_phone_otp_challenges()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.phone_otp_challenges where created_at < now() - interval '24 hours';
$$;
revoke all on function public.cleanup_phone_otp_challenges() from public, anon, authenticated;

-- 3. Optional avatar storage ---------------------------------------------------
-- Private bucket is not needed: profile photos are shown to riders at pickup,
-- so a public read URL is appropriate. Paths are <user-id>/profile.jpg and the
-- backend (service role) is the only writer.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 4. Verification notes --------------------------------------------------------
-- Run after deploying:
--   select count(*) from public.phone_otp_challenges;  -- should be 0
--   select phone_e164, phone_verified_at from public.profiles limit 5;
