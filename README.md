# KABAZA

**Move Salima. One ride at a time.**

KABAZA is a Malawi-built bike-hailing, delivery and on-demand commerce platform. One codebase powers:

- 🌐 **Marketing website** — `www/index.html`
- 📱 **Web app** (customer, rider and admin) — `www/app/index.html`
- 🤖 **Native Android APK** — Capacitor wrapper in `android/`

The committed configuration points at the **live Supabase project and PayChangu backend**. If `www/app/js/config.js` is emptied, the app falls back to a clearly labelled localStorage demo so screens can still be explored offline. There is no fake OTP or fake payment success: phone verification fails closed until an SMS/WhatsApp provider is configured on the server, and payments are verified with PayChangu.

---

## What's included

| Side | Features |
|---|---|
| Customer | Book a ride, send a parcel, shop food/grocery/alcohol, cart & checkout, PayChangu mobile money, live order tracking, provenance timeline |
| Rider | Go online/offline, live job offers, accept jobs, status updates, navigation links, earnings, profile |
| Admin | Dashboard, products & stock, vendors, orders & rider assignment, riders, users/roles, zones & pricing, settings, provenance ledger |
| Accounts | Phone-first passenger sign-up (SMS/WhatsApp OTP), optional email and photo, phone login, OTP password reset, customer-only role; separate admin-approved rider onboarding |

### Supply chain / blockchain-ready provenance

`ledger_entries` is an **append-only, hash-chained audit log**. Each row stores
`prev_hash`, `hash`, `entity_type`, `entity_id`, `event_type`, `payload`, and
reserved `anchored_tx` / `anchored_at` columns for a future on-chain anchor.
No blockchain writes happen today — the schema is simply designed so an
anchor can be added later without restructuring. Writes go through the
`append_ledger_entry()` SQL function / backend service role, never from the client.

### Payments

PayChangu secret keys live **only on the server** (`server/`), never in the web
app. The backend creates a checkout with an amount read from the database,
verifies it with PayChangu and only then marks the order paid. The PayChangu key
uses only `payment:read`, `payment:create` and `transaction:read`. Webhooks are
HMAC-SHA256 verified over the raw body; a valid IPN is only logged — the
authoritative `/verify-payment/:txRef` call decides whether an order is paid.

### Phone-first accounts

Passenger registration asks for full name, active `+265` number, optional email,
password, optional photo and Terms/Privacy consent. A 6-digit OTP is sent by the
backend through WhatsApp Cloud API or a generic SMS HTTP adapter. Codes expire
after 10 minutes, are stored only as salted hashes, allow 5 guesses and 5
requests per phone per hour, and have a 60-second resend cooldown. If no provider
is configured the API returns `503 provider_not_configured` — no code is ever
simulated or returned to the app. Passenger accounts are always `customer`;
riders join through admin-approved onboarding with vehicle and licence checks.

---

## Live KABAZA

- Website: https://malu-xvge.github.io/kabaza/
- App: https://malu-xvge.github.io/kabaza/app/
- APK: https://github.com/Malu-xvge/kabaza/releases/latest/download/kabaza.apk
- Backend: https://kabaza-payments.onrender.com
- Supabase project: `lireychwvpdqrbhxocka`

Developer demo logins (live project): `demo.customer@kabaza.app`,
`demo.rider@kabaza.app`, `demo.admin@kabaza.app` — password `Kabaza@Demo2026`.
Original admin: `admin@kabaza.app` / `Kabaza@2026`.

---

## Quick start (demo)

```bash
npm install
python -m http.server 4173 --directory www
# open http://localhost:4173/
```

- Marketing site: `http://localhost:4173/`
- Web app: `http://localhost:4173/app/index.html`
- Sign in with any email/password, then choose **Customer**, **Rider** or **Admin**.
- Use the **Switch role** option in the sidebar/nav to explore all three sides.

Run the JS syntax check with:

```bash
npm run check
```

---

## Going live

You need a **fresh Supabase project for KABAZA** (do not reuse credentials from
other projects).

1. In Supabase SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`,
   then `supabase/migrations/20261123_phone_otp.sql` (OTP table, verification
   columns, `avatars` bucket). The migration is idempotent.
2. Create your admin user in Supabase Auth, then set their `role` to `admin` in
   `public.profiles` (see `supabase/README.md`). Keep **Confirm email** off.
3. Fill in `www/app/js/config.js` with the project URL, anon/publishable key and
   your payment API base URL.
4. Copy `server/.env.example` → `server/.env` and set
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYCHANGU_SECRET_KEY`,
   `PAYCHANGU_WEBHOOK_SECRET`, `PAYCHANGU_API_BASE`, `BASE_URL`,
   `ALLOWED_ORIGINS`, `PORT`, and one OTP provider (`OTP_PROVIDER=whatsapp` or
   `sms` plus its credentials).
5. Deploy `server/` (e.g. Render) and point `paymentApiBase` at it. Confirm
   `/health` and that `OTP provider:` in the startup log is not `NOT configured`.
6. Rebuild the APK: `npm run build:apk`. Android 7.0+ (API 24) is the minimum;
   Android 4.x is not supported by modern Capacitor/Supabase.

Detailed notes: `supabase/README.md` and `server/README.md`.

---

## Build the Android APK

```bash
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug      # Windows
# ./gradlew assembleDebug        # macOS/Linux
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`
A copy for release is also kept at `releases/kabaza.apk` after `npm run release:apk`.

The APK declares coarse/fine location permissions and asks for them at runtime
after sign-in. Location is optional: refusing the prompt does not block rides
or shopping, but pickup maps and rider tracking need it. A visible sign-out
button is in the app's top bar as well as the sidebar so it is always reachable
inside the APK.

---

## Repository layout

```
www/                     marketing site + web app (Capacitor webDir)
  index.html             marketing entry (redirects to app inside the APK)
  app/index.html         full web app entry
  app/js/config.js       public config (live Supabase + backend URLs)
  app/js/db.js           Supabase / localStorage data layer + hardened sign-out
  app/js/auth.js         phone OTP registration + recovery wizard
  app/js/permissions.js  native Android runtime location request
  app/js/payments.js     PayChangu client (server-mediated)
  app/js/customer|rider|admin/
  terms.html, privacy.html legal pages linked from app and website
supabase/                schema, seed, migrations, setup notes
server/                  Express payments + phone auth (service role, never in client)
android/                 generated Capacitor Android project
releases/                distributable APK
SPEC.md                  shared architecture/data/payment contract
```

---

## Licence / responsibility

Alcohol products are marked 18+. Age is verified in the app and riders may ask
for ID on delivery. Please drink responsibly.
