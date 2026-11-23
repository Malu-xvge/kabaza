# KABAZA payments service

A small Express service that holds the PayChangu secret key and the Supabase
**service role** key. The web app never sees either secret: it asks this service
for a checkout URL, the customer pays on PayChangu, and this service verifies the
payment before any order is marked paid.

## Endpoints

- `GET /health` → `{ ok, configured, currency }`
- `GET /api/config` → `{ paymentsEnabled, currency }`
- `POST /api/payment/initiate` `{ "orderId": "<uuid>" }`
  - Loads `orders` from Supabase with the service role key.
  - Uses `orders.total` as the amount — a client-sent price is never accepted.
  - Rejects already-paid orders and non-positive totals.
  - Creates a `kbz_<12hex>_<10hex>` tx_ref, opens a PayChangu session, inserts a
    `payments` row (`status='pending'`) and sets `orders.tx_ref` plus
    `orders.payment_status='pending'`.
  - Returns `{ txRef, checkoutUrl, amount, orderId }`.
- `GET /api/payment/verify/:txRef`
  - Looks the tx_ref up in `payments`, then calls PayChangu `/verify-payment/:txRef`.
  - Only marks paid when the provider status is `success`, currency is `MWK`,
    the tx_ref matches, and the paid amount is at least the DB amount.
  - On success: `payments.status='success'`, `verified_at`, `raw` updated;
    `orders.payment_status='paid'`; an `order_events` row with status `paid` and
    note `Payment confirmed` is inserted.
  - Returns `{ status, orderId, amount, currency }`.
- `POST /api/payment/callback` — PayChangu IPN. Logged and acknowledged with
  `{ received: true }`; **never** used on its own to mark an order paid.
- `POST /api/ledger/append` `{ entity_type, entity_id?, event_type, payload?, actor_id? }`
  - Supply-chain provenance write. Validates that ids are UUIDs (when present)
    and calls the `append_ledger_entry()` security-definer RPC with the service
    role. The browser never writes `ledger_entries` directly, so the hash chain
    cannot be forged. Responds `201 { entry }`.
- `GET /payment/return` — "Return to KABAZA" page shown after cancel/complete.

### Phone authentication endpoints

- `POST /api/auth/otp/request` `{ phone, purpose: 'register'|'reset' }`
  - Normalises to `+265…`, checks duplicate/inactive accounts and rate limits.
  - Sends a 6-digit code via the configured SMS or WhatsApp adapter.
  - Returns `{ ok, channel, maskedPhone, expiresInSeconds, resendAfterSeconds }`.
  - **Never returns the code.** Without a configured provider: `503 provider_not_configured`.
  - Unknown number for `reset` gets the same success response as a known number, but no message is sent.
- `POST /api/auth/otp/verify` `{ phone, purpose, code }`
  - Constant-time comparison against the stored hash; 5 attempts max.
  - On success returns a short-lived HMAC-signed `verificationToken` (10 minutes).
- `POST /api/auth/register` `{ phone, fullName, email?, password, city?, photoDataUrl?, termsAccepted, privacyAccepted, verificationToken }`
  - Creates a Supabase Auth user and a **customer** profile only.
  - No email → internal identity `<digits>@phone.kabaza.local` (no Gmail needed).
  - Optional photo is uploaded to the `avatars` bucket by the service role.
  - Returns Supabase access/refresh tokens so the app can start a session without a password round-trip.
- `POST /api/auth/login` `{ phone, password }` — phone + password sign-in for accounts created without an email.
- `POST /api/auth/reset-password` `{ phone, verificationToken, newPassword }` — OTP-backed recovery without an inbox.

All auth routes use the service role. OTP codes, hashes, challenges and token
signing happen only on this server; the app never receives them.

## Local test (no real money)

```powershell
cd server
npm install

# terminal 1 - fake PayChangu on port 8788
node mock-provider.js

# terminal 2 - our service pointed at the fake
$env:PAYCHANGU_API_BASE="http://localhost:8788"
$env:PAYCHANGU_SECRET_KEY="test"
$env:BASE_URL="http://localhost:8787"
$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR-SERVICE-ROLE-KEY"
$env:ALLOWED_ORIGINS="*"
# Optional: test OTP against a local mock SMS endpoint, e.g. http://localhost:8793/send
$env:OTP_PROVIDER="sms"
$env:SMS_API_URL="http://localhost:8793/send"
$env:SMS_API_BODY_TEMPLATE='{"to":"{phone}","message":"{message}"}'
node server.js
```

Run the OTP database migration in Supabase first:
`supabase/migrations/20261123_phone_otp.sql`. With no OTP provider the auth
endpoints correctly return `503 provider_not_configured`.

Use a **test/demo** Supabase project for local runs. Never put a real service
role key in a committed file. Copy `.env.example` to `.env` for local work
instead; `.env` stays out of git.

Syntax check both scripts with:

```powershell
npm run check
```

Point the app at this service in `www/app/js/config.js`:

```js
paymentApiBase: 'http://localhost:8787',
paymentsEnabled: true
```

Then open a checkout in the app, click **Pay now** on the mock page, and watch
the order become paid after verification.

## Deploy to Render (free tier)

1. Push the repo to GitHub (new repo `Malu-xvge/kabaza`).
2. Render → New → Web Service.
3. Root directory: `server`
4. Build command: `npm install`
5. Start command: `node server.js`
6. Environment variables:
   - `PAYCHANGU_SECRET_KEY` = your PayChangu secret key
   - `PAYCHANGU_API_BASE` = `https://api.paychangu.com`
   - `BASE_URL` = `https://<your-service>.onrender.com`
   - `PORT` = `8787` (Render also injects its own `PORT`; either works)
   - `ALLOWED_ORIGINS` = your GitHub Pages origin, or `*` while testing
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
   - `PAYCHANGU_WEBHOOK_SECRET` = webhook secret from PayChangu dashboard
   - `OTP_PROVIDER` = `whatsapp` or `sms`, plus that provider's variables from `.env.example`
   - `OTP_TOKEN_SECRET` = optional; otherwise derived from the service role key
7. Set `www/app/js/config.js` to the Render URL:

```js
paymentApiBase: 'https://kabaza-payments.onrender.com',
paymentsEnabled: true
```

Render's free tier sleeps after inactivity, so the first request can take ~30s.

## Environment variables

| Variable | Purpose |
|---|---|
| `PAYCHANGU_SECRET_KEY` | Server-only PayChangu secret. Least-privilege scopes: `payment:read`, `payment:create`, `transaction:read`. Required to create/verify payments. |
| `PAYCHANGU_WEBHOOK_SECRET` | Shared secret from the PayChangu dashboard. Verifies the IPN `Signature` header (HMAC-SHA256 over the raw body). IPNs are rejected if missing. |
| `PAYCHANGU_API_BASE` | PayChangu API base. Defaults to `https://api.paychangu.com`. |
| `BASE_URL` | Public base URL used for callback/return URLs. |
| `PORT` | Listen port. Defaults to `8787`. |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins, or `*` for all. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used for `orders`, `payments`, `order_events`, phone auth and avatar uploads. |
| `OTP_PROVIDER` | `whatsapp` or `sms`. Empty = OTP endpoints fail closed with 503. |
| `OTP_TOKEN_SECRET` | Optional HMAC secret for 10-minute verification tokens; derived from the service key when empty. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANGUAGE`, `WHATSAPP_TEMPLATE_KIND`, `WHATSAPP_API_VERSION` | WhatsApp Cloud API settings. Use an approved Meta **authentication** template with `{{1}}` for the code; its expiry is fixed footer text. Set `WHATSAPP_TEMPLATE_KIND=custom` only for a custom utility template with `{{1}}` code and `{{2}}` expiry minutes. |
| `SMS_API_URL`, `SMS_API_METHOD`, `SMS_API_BODY_TEMPLATE`, `SMS_API_HEADERS`, `SMS_API_AUTH_TOKEN`, `SMS_API_MESSAGE` | Generic SMS HTTP adapter. Supports `{phone}`, `{digits}`, `{code}` and `{message}` placeholders. |

If the PayChangu secret is missing, `/health` reports `configured: false` and
payment routes return `503 { error: 'payments_not_configured' }`. If Supabase
env is missing, payment routes return `503 { error: 'database_not_configured' }`.

## Security notes

- The PayChangu secret and Supabase service role key stay on the server only.
  The app never receives them.
- The price always comes from `orders.total` in the database, never from the
  request body.
- An order is marked paid only after `/verify-payment/:txRef` confirms success
  with matching currency, tx_ref and amount at least the DB amount.
- The IPN callback requires a valid `Signature` header: HMAC-SHA256 of the raw
  request body keyed with `PAYCHANGU_WEBHOOK_SECRET`. Invalid requests get 403.
  Even a valid IPN is only logged — it can never mark an order paid. Payment
  status always comes from the server's `/verify-payment/:txRef` call.
- OTP codes are sent only to the configured provider, stored only as salted
  hashes, rate-limited and expired after 10 minutes. Nothing logs a code and no
  endpoint returns one. The `phone_otp_challenges` table has RLS enabled with no
  client policies.
- Verification tokens are HMAC-signed and single-use; registration and password
  reset reject a reused token.
- Do not commit `.env` or log request bodies containing credentials.
