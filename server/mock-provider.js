// Local stand-in for the PayChangu API. Lets us test the whole KABAZA flow offline.
// Run on port 8788:  node mock-provider.js
// Then start the real server with:
//   PAYCHANGU_API_BASE=http://localhost:8788 PAYCHANGU_SECRET_KEY=test node server.js
const http = require('http');

const PORT = process.env.MOCK_PORT || 8788;
const payments = new Map();

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/payment') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) {}
      if (!body.tx_ref || !body.amount) {
        return json(res, 400, { status: 'failed', message: 'amount and tx_ref are required' });
      }
      payments.set(body.tx_ref, {
        tx_ref: body.tx_ref,
        amount: Number(body.amount),
        currency: body.currency || 'MWK',
        status: 'pending',
        return_url: body.return_url || ''
      });
      return json(res, 200, {
        message: 'Hosted payment session generated successfully.',
        status: 'success',
        data: {
          event: 'checkout.session:created',
          checkout_url: `http://localhost:${PORT}/checkout?tx_ref=${encodeURIComponent(body.tx_ref)}`,
          data: {
            tx_ref: body.tx_ref,
            currency: body.currency || 'MWK',
            amount: Number(body.amount),
            mode: 'sandbox',
            status: 'pending'
          }
        }
      });
    });
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/verify-payment/')) {
    const txRef = decodeURIComponent(url.pathname.slice('/verify-payment/'.length));
    const p = payments.get(txRef);
    if (!p) return json(res, 404, { status: 'failed', message: 'not found' });
    return json(res, 200, {
      status: 'success',
      message: 'Payment details retrieved successfully.',
      data: {
        event_type: 'checkout.payment',
        tx_ref: p.tx_ref,
        mode: 'sandbox',
        status: p.status,
        currency: p.currency,
        amount: p.amount,
        reference: 'MOCK' + p.tx_ref.slice(-5).toUpperCase(),
        authorization: { channel: 'Mobile Money', provider: 'TNM Mpamba' }
      }
    });
  }

  if (req.method === 'GET' && url.pathname === '/checkout') {
    const txRef = url.searchParams.get('tx_ref') || '';
    const p = payments.get(txRef);
    if (!p) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Unknown payment');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock PayChangu — KABAZA</title>
<style>
body{font-family:system-ui,sans-serif;background:#052e1c;color:#fff;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:380px;width:100%;background:#0a3c26;border-radius:18px;padding:24px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.45)}
h1{font-size:1.1rem;color:#b7f34a;margin:0 0 8px}
.amount{font-size:2rem;font-weight:800;margin:12px 0;color:#fff}
.ref{font-size:.72rem;opacity:.55;word-break:break-all;margin-bottom:20px}
button{display:block;width:100%;padding:14px;border:0;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;margin-top:10px}
.pay{background:#b7f34a;color:#052e1c}
.cancel{background:transparent;color:#b7f34a;border:1px solid #2f6b4d}
</style></head><body><div class="card">
<h1>Mock PayChangu — KABAZA</h1>
<div class="amount">MK ${p.amount.toLocaleString('en-US')}</div>
<div class="ref">${p.tx_ref}</div>
<button class="pay" onclick="location.href='/pay?tx_ref=${encodeURIComponent(txRef)}'">Pay now</button>
<button class="cancel" onclick="location.href='/cancel?tx_ref=${encodeURIComponent(txRef)}'">Cancel</button>
</div></body></html>`);
  }

  if (req.method === 'GET' && (url.pathname === '/pay' || url.pathname === '/cancel')) {
    const txRef = url.searchParams.get('tx_ref') || '';
    const p = payments.get(txRef);
    if (!p) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Unknown payment');
    }
    p.status = url.pathname === '/pay' ? 'success' : 'failed';
    const back = p.return_url || '/';
    res.writeHead(302, { Location: back });
    return res.end();
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`Mock PayChangu — KABAZA on http://localhost:${PORT}`));
