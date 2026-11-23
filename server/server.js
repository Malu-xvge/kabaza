// KABAZA payment backend.
// Holds the PayChangu secret key and the Supabase service role key, creates
// checkout sessions for orders and verifies payments before marking them paid.
// The app only ever sees a checkout URL and a tx_ref.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
// Keep the exact bytes of every JSON request. PayChangu signs the RAW body,
// so re-serialising req.body would produce a different hash and always fail.
app.use(express.json({
  limit: '32kb',
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); }
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').trim();
app.use(cors({
  origin: allowedOrigins === '*'
    ? true
    : allowedOrigins.split(',').map(s => s.trim()).filter(Boolean)
}));

const SECRET = (process.env.PAYCHANGU_SECRET_KEY || '').trim();
// Separate shared secret from PayChangu dashboard -> API & Webhooks. Used only
// to authenticate incoming IPNs; never sent to the browser or stored in git.
const WEBHOOK_SECRET = (process.env.PAYCHANGU_WEBHOOK_SECRET || '').trim();
const API_BASE = (process.env.PAYCHANGU_API_BASE || 'https://api.paychangu.com').replace(/\/+$/, '');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/+$/, '');
const PORT = process.env.PORT || 8787;
const CURRENCY = 'MWK';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

let db = null;

function getDb() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  if (!db) {
    try {
      db = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (e) {
      console.error('[KABAZA] Supabase client init failed:', e && e.message);
      return null;
    }
  }
  return db;
}

function paymentsConfigured() {
  return Boolean(SECRET);
}

function fullyConfigured() {
  return Boolean(SECRET && getDb());
}

function requirePayments(res) {
  if (paymentsConfigured()) return true;
  res.status(503).json({
    error: 'payments_not_configured',
    message: 'PAYCHANGU_SECRET_KEY is not set on the server'
  });
  return false;
}

function requireDatabase(res) {
  const client = getDb();
  if (client) return client;
  res.status(503).json({
    error: 'database_not_configured',
    message: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server'
  });
  return null;
}

function originFor(req) {
  return BASE_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
}

// tx_ref = kbz_<12hex from order id>_<10hex nonce>.
// The order id is not sent by the client at verify time: the payments row maps
// tx_ref back to the order. The stub is only a human-readable hint.
function orderStub(orderId) {
  const id = String(orderId || '');
  const hexOnly = id.replace(/[^0-9a-f]/gi, '').toLowerCase();
  return hexOnly.length >= 12
    ? hexOnly.slice(0, 12)
    : crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function newTxRef(orderId) {
  return `kbz_${orderStub(orderId)}_${crypto.randomBytes(5).toString('hex')}`;
}

function dbFailure(res, error, context) {
  console.error(`[KABAZA] ${context}:`, error && error.message ? error.message : error);
  return res.status(500).json({ error: 'database_error', message: 'Database request failed' });
}

function providerFailure(res, response, body) {
  const detail = body && (body.message || body.error) ? (body.message || body.error) : 'unknown error';
  console.error('[KABAZA] provider payment request failed:', response.status, detail);
  return res.status(502).json({
    error: 'provider_error',
    message: (body && body.message) || 'Payment provider rejected the request'
  });
}

app.get('/health', (req, res) => {
  res.json({ ok: true, configured: fullyConfigured(), currency: CURRENCY });
});

// Public config for www/app/js/config.js. Never exposes secrets.
app.get('/api/config', (req, res) => {
  res.json({ paymentsEnabled: fullyConfigured(), currency: CURRENCY });
});

app.post('/api/payment/initiate', async (req, res) => {
  if (!requirePayments(res)) return;
  const db = requireDatabase(res);
  if (!db) return;

  const orderId = String((req.body && req.body.orderId) || '').trim();
  if (!orderId) {
    return res.status(400).json({ error: 'order_id_required', message: 'orderId is required' });
  }

  let order;
  try {
    const { data, error } = await db
      .from('orders')
      .select('id,total,payment_status')
      .eq('id', orderId)
      .limit(1);
    if (error) return dbFailure(res, error, 'load order');
    order = Array.isArray(data) ? data[0] : null;
  } catch (e) {
    return dbFailure(res, e, 'load order');
  }

  if (!order) {
    return res.status(404).json({ error: 'order_not_found', message: 'Order not found' });
  }
  if (String(order.payment_status || '').toLowerCase() === 'paid') {
    return res.status(400).json({ error: 'already_paid', message: 'Order has already been paid' });
  }

  // The amount always comes from the DB. A tampered client cannot change it.
  const amount = Number(order.total);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'invalid_amount', message: 'Order total must be greater than zero' });
  }

  const txRef = newTxRef(order.id || orderId);
  const origin = originFor(req);
  const payload = {
    amount: String(amount),
    currency: CURRENCY,
    tx_ref: txRef,
    callback_url: `${origin}/api/payment/callback`,
    return_url: `${origin}/payment/return?tx_ref=${encodeURIComponent(txRef)}`,
    customization: {
      title: 'KABAZA',
      description: `KABAZA order ${order.id || orderId}`
    }
  };

  let body;
  try {
    const response = await fetch(`${API_BASE}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${SECRET}`
      },
      body: JSON.stringify(payload)
    });
    body = await response.json().catch(() => null);

    if (!response.ok || !body || body.status !== 'success' || !body.data || !body.data.checkout_url) {
      return providerFailure(res, response, body);
    }
  } catch (e) {
    console.error('[KABAZA] initiate network error:', e && e.message);
    return res.status(502).json({ error: 'network_error', message: 'Could not reach the payment provider' });
  }

  try {
    const { error: paymentError } = await db.from('payments').insert({
      order_id: order.id || orderId,
      tx_ref: txRef,
      amount: amount,
      currency: CURRENCY,
      provider: 'paychangu',
      status: 'pending',
      raw: body
    });
    if (paymentError) return dbFailure(res, paymentError, 'create payments row');

    const { error: orderError } = await db
      .from('orders')
      .update({ tx_ref: txRef, payment_status: 'pending' })
      .eq('id', order.id || orderId);
    if (orderError) return dbFailure(res, orderError, 'update order to pending');
  } catch (e) {
    return dbFailure(res, e, 'save payment');
  }

  return res.json({
    txRef,
    checkoutUrl: body.data.checkout_url,
    amount,
    orderId: order.id || orderId
  });
});

app.get('/api/payment/verify/:txRef', async (req, res) => {
  if (!requirePayments(res)) return;
  const db = requireDatabase(res);
  if (!db) return;

  const txRef = String(req.params.txRef || '').trim();
  if (!txRef) {
    return res.status(400).json({ error: 'invalid_tx_ref', message: 'tx_ref is required' });
  }

  let payment;
  try {
    const { data, error } = await db
      .from('payments')
      .select('id,order_id,tx_ref,amount,currency,status')
      .eq('tx_ref', txRef)
      .limit(1);
    if (error) return dbFailure(res, error, 'load payment');
    payment = Array.isArray(data) ? data[0] : null;
  } catch (e) {
    return dbFailure(res, e, 'load payment');
  }

  if (!payment) {
    return res.status(404).json({ error: 'payment_not_found', message: 'No payment found for that reference' });
  }

  const dbAmount = Number(payment.amount);
  const dbCurrency = String(payment.currency || CURRENCY).toUpperCase();

  let body;
  try {
    const response = await fetch(`${API_BASE}/verify-payment/${encodeURIComponent(txRef)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${SECRET}` }
    });
    body = await response.json().catch(() => null);
    if (!response.ok) {
      const status = String((body && body.status) || 'failed').toLowerCase();
      console.error('[KABAZA] provider verify error:', response.status, status);
      return res.json({
        status,
        orderId: payment.order_id,
        amount: Number.isFinite(dbAmount) ? dbAmount : 0,
        currency: (body && body.currency) || dbCurrency
      });
    }
  } catch (e) {
    console.error('[KABAZA] verify network error:', e && e.message);
    return res.status(502).json({ error: 'network_error', message: 'Could not reach the payment provider' });
  }

  const data = (body && body.data) || {};
  const providerStatus = String(data.status || (body && body.status) || 'pending').toLowerCase();
  const paidAmount = Number(data.amount);
  const providerCurrency = String(data.currency || '').toUpperCase();
  const success = providerStatus === 'success'
    && providerCurrency === CURRENCY
    && dbCurrency === CURRENCY
    && String(data.tx_ref || '').toLowerCase() === txRef.toLowerCase()
    && String(payment.tx_ref || '').toLowerCase() === txRef.toLowerCase()
    && Number.isFinite(paidAmount)
    && Number.isFinite(dbAmount)
    && paidAmount >= dbAmount;

  if (!success) {
    // A provider "success" that fails our checks is NOT a paid order.
    const status = providerStatus === 'success' ? 'failed' : (providerStatus || 'pending');
    return res.json({
      status,
      orderId: payment.order_id,
      amount: Number.isFinite(dbAmount) ? dbAmount : 0,
      currency: providerCurrency || dbCurrency
    });
  }

  try {
    const { error: paymentError } = await db
      .from('payments')
      .update({
        status: 'success',
        verified_at: new Date().toISOString(),
        raw: body
      })
      .eq('id', payment.id);
    if (paymentError) return dbFailure(res, paymentError, 'update payment to success');

    const { error: orderError } = await db
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', payment.order_id);
    if (orderError) return dbFailure(res, orderError, 'update order to paid');

    const { error: eventError } = await db.from('order_events').insert({
      order_id: payment.order_id,
      status: 'paid',
      note: 'Payment confirmed'
    });
    if (eventError) return dbFailure(res, eventError, 'insert paid order event');
  } catch (e) {
    return dbFailure(res, e, 'record successful payment');
  }

  return res.json({
    status: 'success',
    orderId: payment.order_id,
    amount: dbAmount,
    currency: CURRENCY
  });
});

// PayChangu IPN. The "Signature" header is HMAC-SHA256 over the RAW request
// body, keyed with the webhook secret from the PayChangu dashboard. Reject
// anything that does not verify. Even a valid IPN is only logged here: orders
// are marked paid exclusively by /api/payment/verify/:txRef, which asks
// PayChangu for the authoritative status. Never trust this body for money.
app.post('/api/payment/callback', (req, res) => {
  const signature = String(req.headers['signature'] || '').trim();
  const raw = typeof req.rawBody === 'string' ? req.rawBody : '';

  if (!WEBHOOK_SECRET) {
    console.error('[KABAZA] IPN rejected: PAYCHANGU_WEBHOOK_SECRET is not set');
    return res.status(503).json({ received: false, error: 'webhook_not_configured' });
  }
  if (!signature || !raw) {
    console.warn('[KABAZA] IPN rejected: missing signature or raw body');
    return res.status(400).json({ received: false, error: 'missing_signature' });
  }

  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
  let valid = false;
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    valid = false;
  }
  if (!valid) {
    console.warn('[KABAZA] IPN rejected: invalid signature');
    return res.status(403).json({ received: false, error: 'invalid_signature' });
  }

  const txRef = (req.body && (req.body.tx_ref || req.body.txref || req.body.reference))
    || req.query.tx_ref
    || req.query.txref;
  console.log('[KABAZA] IPN verified:', txRef || '(no tx_ref)');
  return res.status(200).json({ received: true });
});

app.get('/payment/return', (req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KABAZA payment</title>
<style>
body{font-family:system-ui,sans-serif;background:#052e1c;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0;padding:24px}
div{max-width:420px}
h1{color:#b7f34a;font-size:1.5rem;margin:0 0 12px}
p{opacity:.85;line-height:1.6;margin:0 0 10px}
.small{font-size:.85rem;opacity:.6}
</style></head>
<body><div><h1>Return to KABAZA</h1>
<p>You can close this page. KABAZA will confirm your payment automatically when you return to the app.</p>
<p class="small">Your order will update as soon as the payment is verified.</p>
</div></body></html>`);
});

// Supply-chain provenance. The web app never writes to ledger_entries directly;
// it POSTs here and this service calls the security-definer RPC with the service
// role, so the hash chain cannot be forged by a client.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validUuidOrNull(value) {
  return value == null || UUID_RE.test(String(value));
}

app.post('/api/ledger/append', async (req, res) => {
  const client = requireDatabase(res);
  if (!client) return;
  const b = req.body || {};
  const entityType = String(b.entity_type || '').trim().slice(0, 64);
  const eventType = String(b.event_type || '').trim().slice(0, 64);
  const entityId = b.entity_id == null ? null : String(b.entity_id);
  const actorId = b.actor_id == null ? null : String(b.actor_id);
  const payload = b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload)
    ? b.payload : {};

  if (!entityType || !eventType || !validUuidOrNull(entityId) || !validUuidOrNull(actorId)) {
    return res.status(400).json({
      error: 'invalid_ledger_entry',
      message: 'entity_type and event_type are required; ids must be UUIDs when present'
    });
  }

  const { data, error } = await client.rpc('append_ledger_entry', {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_event_type: eventType,
    p_payload: payload,
    p_actor_id: actorId
  });
  if (error) return dbFailure(res, error, 'ledger append');
  return res.status(201).json({ entry: data });
});

app.use((err, req, res, next) => {
  console.error('[KABAZA] request error:', err && err.message);
  if (res.headersSent) return next(err);
  res.status(400).json({ error: 'bad_request', message: 'Invalid request body' });
});

app.listen(PORT, () => {
  console.log(`KABAZA payments listening on ${PORT}`);
  console.log(`PayChangu API: ${API_BASE}`);
  console.log(`Database: ${getDb() ? 'configured' : 'NOT configured - check Supabase env'}`);
  console.log(`Payments: ${SECRET ? 'configured' : 'NOT configured - check PAYCHANGU_SECRET_KEY'}`);
  console.log(`Webhook signing: ${WEBHOOK_SECRET ? 'configured' : 'NOT configured - check PAYCHANGU_WEBHOOK_SECRET'}`);
});
