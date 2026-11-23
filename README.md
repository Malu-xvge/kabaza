# KABAZA

**Move Malawi. One ride at a time.**

KABAZA is a Malawi-built bike-hailing, delivery and on-demand commerce platform. One codebase powers:

- 🌐 **Marketing website** — `www/index.html`
- 📱 **Web app** (customer, rider and admin) — `www/app/index.html`
- 🤖 **Native Android APK** — Capacitor wrapper in `android/`

The web app runs in **demo mode** out of the box (localStorage-backed) so every screen and flow can be explored before any credentials are configured.

---

## What's included

| Side | Features |
|---|---|
| Customer | Book a ride, send a parcel, shop food/grocery/alcohol, cart & checkout, PayChangu mobile money, live order tracking, provenance timeline |
| Rider | Go online/offline, live job offers, accept jobs, status updates, navigation links, earnings, profile |
| Admin | Dashboard, products & stock, vendors, orders & rider assignment, riders, users/roles, zones & pricing, settings, provenance ledger |

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
verifies it with PayChangu and only then marks the order paid. Without a
configured backend, the app shows a clearly labelled demo checkout sheet.

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

1. In Supabase SQL editor, run `supabase/schema.sql`, then `supabase/seed.sql`.
2. Create your admin user in Supabase Auth, then set their `role` to `admin` in
   `public.profiles` (see `supabase/README.md`).
3. Fill in `www/app/js/config.js` with the project URL, anon/publishable key and
   your payment API base URL.
4. Copy `server/.env.example` → `server/.env` and set
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYCHANGU_SECRET_KEY`,
   `PAYCHANGU_API_BASE`, `BASE_URL`, `ALLOWED_ORIGINS`, `PORT`.
5. Deploy `server/` (e.g. Render) and point `paymentApiBase` at it.
6. Rebuild the APK: `npm run build:apk`.

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

---

## Repository layout

```
www/                     marketing site + web app (Capacitor webDir)
  index.html             marketing entry (redirects to app inside the APK)
  app/index.html         full web app entry
  app/js/config.js       public config placeholders
  app/js/db.js           Supabase / localStorage data layer + ledger helpers
  app/js/payments.js     PayChangu client (server-mediated)
  app/js/customer|rider|admin/
supabase/                schema, seed, setup notes
server/                  Express PayChangu service (service role, never in client)
android/                 generated Capacitor Android project
releases/                distributable APK
SPEC.md                  shared architecture/data/payment contract
```

---

## Licence / responsibility

Alcohol products are marked 18+. Age is verified in the app and riders may ask
for ID on delivery. Please drink responsibly.
