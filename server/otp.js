// KABAZA phone verification helpers.
// Secrets and OTP codes never leave this module except via the configured
// provider request. Nothing here logs a code or returns one to a caller.
'use strict';

const crypto = require('crypto');

const OTP_TTL_SECONDS = 600;          // codes expire after 10 minutes
const RESEND_SECONDS = 60;            // one code per minute
const MAX_PER_HOUR = 5;               // per phone number
const MAX_ATTEMPTS = 5;               // wrong guesses per challenge
const TOKEN_TTL_SECONDS = 600;        // verified-token lifetime
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

class OtpError extends Error {
  constructor(code, message, status, extra) {
    super(message);
    this.code = code;
    this.status = status || 400;
    this.extra = extra || {};
  }
}

function normalizePhone(input) {
  let s = String(input == null ? '' : input).replace(/[^\d+]/g, '');
  if (s.startsWith('+265')) s = '+' + s.slice(1);
  else if (s.startsWith('265')) s = '+' + s;
  else if (s.startsWith('0')) s = '+265' + s.slice(1);
  else if (s.length === 9) s = '+265' + s;
  else s = '+265' + s;
  const digits = s.slice(4).replace(/\D/g, '');
  if (!/^\d{9}$/.test(digits)) return null;
  return '+265' + digits;
}

function maskPhone(phone) {
  const p = normalizePhone(phone);
  return p ? p.slice(0, 4) + ' *** *** ' + p.slice(-3) : '(invalid number)';
}

function newCode() {
  // crypto.randomInt avoids modulo bias and is safe for OTP generation.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashChallenge(code, id, phone, purpose) {
  return crypto.createHash('sha256')
    .update(['kbz-otp-v1', id, phone, purpose, code].join('|'))
    .digest('hex');
}

function tokenSecret(serviceKey) {
  if (process.env.OTP_TOKEN_SECRET && process.env.OTP_TOKEN_SECRET.trim()) {
    return process.env.OTP_TOKEN_SECRET.trim();
  }
  // The Supabase service key is high-entropy and server-only. Deriving from it
  // means verification tokens stay valid without another deployment variable.
  if (!serviceKey) throw new Error('Cannot derive OTP token secret: service key missing');
  return crypto.createHmac('sha256', serviceKey).update('kbz-otp-token-v1').digest('hex');
}

function issueToken(payload, serviceKey) {
  const body = Buffer.from(JSON.stringify(Object.assign({}, payload, {
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  }))).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret(serviceKey)).update(body).digest('base64url');
  return body + '.' + sig;
}

function readToken(token, serviceKey) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const expected = crypto.createHmac('sha256', tokenSecret(serviceKey)).update(parts[0]).digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(parts[1]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function configuredProvider() {
  return (process.env.OTP_PROVIDER || '').trim().toLowerCase();
}

function providerConfigured() {
  const provider = configuredProvider();
  if (provider === 'whatsapp') {
    return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }
  if (provider === 'sms') return Boolean(process.env.SMS_API_URL);
  return false;
}

function providerName() {
  return providerConfigured() ? configuredProvider() : null;
}

function sendOtp(phone, code, purpose) {
  const provider = configuredProvider();
  if (!providerConfigured()) {
    // Fail closed. Never echo a code or pretend a message was delivered.
    throw new OtpError(
      'provider_not_configured',
      'No OTP provider is configured on the server. Set OTP_PROVIDER=whatsapp or sms in the backend environment.',
      503
    );
  }

  if (provider === 'whatsapp') {
    const version = (process.env.WHATSAPP_API_VERSION || 'v21.0').trim();
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID.trim();
    // Direct Send is the default: no pre-approved template is needed. Meta
    // infers the OTP and adds a copy-code button when the body contains exactly
    // one 4-6 digit number, so keep "ten minutes" as words, not "10 minutes".
    const sendMode = (process.env.WHATSAPP_SEND_MODE || 'direct').trim().toLowerCase();
    let payload;

    if (sendMode === 'template') {
      const template = (process.env.WHATSAPP_OTP_TEMPLATE || 'kbz_otp').trim();
      const language = (process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US').trim();
      // Meta authentication templates hard-code the expiry text in the template
      // footer, so they only accept {{1}} (the code). A copy-code button needs the
      // same code a second time in a url button component. Set
      // WHATSAPP_TEMPLATE_KIND=custom only if you created a custom utility
      // template with {{1}} (code) and {{2}} (expiry minutes).
      const isCustom = (process.env.WHATSAPP_TEMPLATE_KIND || 'authentication').trim().toLowerCase() === 'custom';
      const components = isCustom
        ? [{
            type: 'body',
            parameters: [
              { type: 'text', text: code },
              { type: 'text', text: String(OTP_TTL_SECONDS / 60) }
            ]
          }]
        : [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: code }]
            }
          ];
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone.replace(/\D/g, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components
        }
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone.replace(/\D/g, ''),
        type: 'text',
        category: 'authentication',
        text: {
          body: `Your KABAZA verification code is ${code}. It expires in ten minutes. Do not share it with anyone.`
        }
      };
    }
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN.trim();
    // Diagnostics only: never log the token, the OTP, or the full request body.
    console.log('[KABAZA] WhatsApp OTP send', JSON.stringify({
      to: payload.to, phoneId: phoneId, version: version, sendMode: sendMode,
      tokenLength: accessToken.length
    }));
    return fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).then(async function (response) {
      if (!response.ok) {
        // Log Meta's error code/message for diagnosis. Never log the request
        // body, the access token, or the OTP itself.
        let detail = '';
        try {
          const parsed = JSON.parse(await response.text());
          const metaError = parsed && parsed.error;
          if (metaError) detail = ` ${metaError.code || ''} ${metaError.message || ''}`.trim().slice(0, 300);
        } catch (e) {
          detail = '';
        }
        console.error('[KABAZA] WhatsApp OTP provider rejected request:', response.status + detail);
        throw new OtpError('provider_error', 'The WhatsApp verification service is unavailable. Please try again.', 502);
      }
      return { provider: 'whatsapp' };
    }).catch(function (e) {
      if (e instanceof OtpError) throw e;
      console.error('[KABAZA] WhatsApp OTP network error:', e && e.message);
      throw new OtpError('provider_error', 'The WhatsApp verification service is unavailable. Please try again.', 502);
    });
  }

  // Generic SMS HTTP adapter. Supports any provider that accepts a JSON POST
  // or GET with {phone} and {code} placeholders in the URL/body.
  const rawUrl = process.env.SMS_API_URL.trim();
  const method = (process.env.SMS_API_METHOD || 'POST').trim().toUpperCase();
  const phoneDigits = phone.replace(/\D/g, '');
  const url = rawUrl.replace(/\{phone\}/g, encodeURIComponent(phone))
    .replace(/\{digits\}/g, encodeURIComponent(phoneDigits))
    .replace(/\{code\}/g, encodeURIComponent(code));
  const message = (process.env.SMS_API_MESSAGE || `Your KABAZA verification code is ${code}. It expires in 10 minutes. Never share it.`)
    .replace(/\{code\}/g, code).replace(/\{phone\}/g, phone);

  const headers = { Accept: 'application/json' };
  try {
    const extra = JSON.parse(process.env.SMS_API_HEADERS || '{}');
    Object.keys(extra).forEach(function (k) { headers[k] = String(extra[k]); });
  } catch (e) {
    throw new OtpError('provider_misconfigured', 'SMS_API_HEADERS must be valid JSON.', 503);
  }
  if (process.env.SMS_API_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SMS_API_AUTH_TOKEN.trim()}`;
  }

  let body;
  if (process.env.SMS_API_BODY_TEMPLATE) {
    headers['Content-Type'] = 'application/json';
    body = process.env.SMS_API_BODY_TEMPLATE
      .replace(/\{code\}/g, code)
      .replace(/\{phone\}/g, phone)
      .replace(/\{digits\}/g, phoneDigits)
      .replace(/\{message\}/g, message);
    // The template may be a JSON object with escaped placeholders; parse it so
    // we always send valid JSON and never a half-replaced string.
    try { JSON.parse(body); } catch (e) {
      throw new OtpError('provider_misconfigured', 'SMS_API_BODY_TEMPLATE must produce valid JSON.', 503);
    }
  } else if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ to: phone, message: message });
  }

  return fetch(url, { method: method, headers: headers, body: method === 'GET' ? undefined : body })
    .then(function (response) {
      if (!response.ok) {
        console.error('[KABAZA] SMS OTP provider rejected request:', response.status);
        throw new OtpError('provider_error', 'The SMS verification service is unavailable. Please try again.', 502);
      }
      return { provider: 'sms' };
    }).catch(function (e) {
      if (e instanceof OtpError) throw e;
      console.error('[KABAZA] SMS OTP network error:', e && e.message);
      throw new OtpError('provider_error', 'The SMS verification service is unavailable. Please try again.', 502);
    });
}

function parsePhoto(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!match) throw new OtpError('invalid_photo', 'Please choose a JPEG, PNG or WebP photo.', 400);
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_PHOTO_BYTES) {
    throw new OtpError('invalid_photo', 'Photo must be smaller than 2 MB.', 400);
  }
  return { buffer: buffer, mime: 'image/' + match[1], ext: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

module.exports = {
  OtpError: OtpError,
  OTP_TTL_SECONDS: OTP_TTL_SECONDS,
  RESEND_SECONDS: RESEND_SECONDS,
  MAX_PER_HOUR: MAX_PER_HOUR,
  MAX_ATTEMPTS: MAX_ATTEMPTS,
  TOKEN_TTL_SECONDS: TOKEN_TTL_SECONDS,
  normalizePhone: normalizePhone,
  maskPhone: maskPhone,
  newCode: newCode,
  hashChallenge: hashChallenge,
  issueToken: issueToken,
  readToken: readToken,
  configuredProvider: configuredProvider,
  providerConfigured: providerConfigured,
  providerName: providerName,
  sendOtp: sendOtp,
  parsePhoto: parsePhoto
};
