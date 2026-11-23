// KABAZA phone-first authentication endpoints.
// All privileged work happens here with the Supabase service role. The browser
// never sees OTP codes, hashes, service keys, or another user's account data.
'use strict';

const crypto = require('crypto');
const otp = require('./otp');

function sendErr(res, e) {
  if (e instanceof otp.OtpError) {
    return res.status(e.status).json(Object.assign({ error: e.code, message: e.message }, e.extra));
  }
  console.error('[KABAZA] auth route error:', e && e.message ? e.message : e);
  return res.status(500).json({ error: 'server_error', message: 'Authentication request failed' });
}

function cleanText(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 120);
}

module.exports = function registerAuthRoutes(app, ctx) {
  const getDb = ctx.getDb;
  const SERVICE_KEY = ctx.SERVICE_KEY;
  const SUPABASE_URL = String(ctx.SUPABASE_URL || '').replace(/\/+$/, '');
  const dbFailure = ctx.dbFailure;

  function requireDb(res) {
    const client = getDb();
    if (client) return client;
    res.status(503).json({ error: 'database_not_configured', message: 'Supabase service role is not configured' });
    return null;
  }

  async function passwordSession(email, password) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email, password: password })
    });
    const body = await response.json().catch(function () { return null; });
    if (!response.ok || !body || !body.access_token || !body.refresh_token) {
      throw new otp.OtpError('sign_in_failed', 'Could not start your session. Please try signing in again.', 401);
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token };
  }

  async function userForPhone(db, phone) {
    const { data: profile, error } = await db.from('profiles')
      .select('id,full_name,phone_e164,is_active')
      .eq('phone_e164', phone).maybeSingle();
    if (error) throw error;
    if (!profile) return null;
    if (profile.is_active === false) {
      throw new otp.OtpError('account_inactive', 'This account is inactive. Contact KABAZA support.', 403);
    }
    const userResult = await db.auth.admin.getUserById(profile.id);
    if (userResult.error || !userResult.data || !userResult.data.user) return null;
    return { profile: profile, user: userResult.data.user };
  }

  function verifyToken(token, phone, purpose) {
    const payload = otp.readToken(token, SERVICE_KEY);
    if (!payload || payload.phone !== phone || payload.purpose !== purpose || !payload.cid) {
      throw new otp.OtpError('invalid_verification_token', 'Phone verification expired. Please request a new code.', 400);
    }
    return payload;
  }

  async function unconsumedChallenge(db, payload, phone, purpose) {
    const { data: challenge, error } = await db.from('phone_otp_challenges')
      .select('*').eq('id', payload.cid).maybeSingle();
    if (error) throw error;
    if (!challenge || challenge.phone_e164 !== phone || challenge.purpose !== purpose ||
        !challenge.consumed_at || challenge.token_used_at) {
      throw new otp.OtpError('invalid_verification_token', 'Phone verification expired. Please request a new code.', 400);
    }
    return challenge;
  }

  // ---------------------------------------------------------------------------
  // 1. Request an OTP. Never returns a code, even when a provider is mocked.
  // ---------------------------------------------------------------------------
  app.post('/api/auth/otp/request', async (req, res) => {
    const db = requireDb(res);
    if (!db) return;
    try {
      const phone = otp.normalizePhone(req.body && req.body.phone);
      if (!phone) {
        return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid Malawian number, e.g. 0999 123 456 or +265 999 123 456.' });
      }
      const purpose = cleanText(req.body && req.body.purpose, 16);
      if (purpose !== 'register' && purpose !== 'reset') {
        return res.status(400).json({ error: 'invalid_purpose', message: 'Invalid verification purpose.' });
      }

      // Fail before touching the database so a missing integration is obvious.
      if (!otp.providerConfigured()) {
        const e = new otp.OtpError('provider_not_configured',
          'SMS/WhatsApp verification is not configured on the server yet. Ask the KABAZA team to set OTP_PROVIDER.', 503,
          { channel: null, configured: false });
        return sendErr(res, e);
      }

      const { data: existing, error: profileError } = await db.from('profiles')
        .select('id').eq('phone_e164', phone).maybeSingle();
      if (profileError) return dbFailure(res, profileError, 'otp duplicate check');
      if (purpose === 'register' && existing) {
        return res.status(409).json({ error: 'account_exists', message: 'This number already has a KABAZA account. Sign in instead.' });
      }
      if (purpose === 'reset' && !existing) {
        // Same response as a bad password: do not disclose whether a number is registered.
        return res.json({ ok: true, channel: otp.providerName(), expiresInSeconds: otp.OTP_TTL_SECONDS,
          resendAfterSeconds: otp.RESEND_SECONDS, maskedPhone: otp.maskPhone(phone) });
      }

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: recent, error: rateError } = await db.from('phone_otp_challenges')
        .select('id,created_at,attempts')
        .eq('phone_e164', phone).gte('created_at', hourAgo)
        .order('created_at', { ascending: false });
      if (rateError) return dbFailure(res, rateError, 'otp rate limit');

      const failures = (recent || []).filter(function (r) { return Number(r.attempts) > 0; });
      if (recent && recent.length >= otp.MAX_PER_HOUR) {
        return res.status(429).json({ error: 'too_many_requests', message: 'Too many codes requested. Try again in an hour.', retryAfterSeconds: 3600 });
      }
      if (failures.length >= 10) {
        return res.status(429).json({ error: 'too_many_attempts', message: 'Too many incorrect codes. Try again later.', retryAfterSeconds: 900 });
      }
      if (recent && recent.length) {
        const age = Date.now() - new Date(recent[0].created_at).getTime();
        if (age < otp.RESEND_SECONDS * 1000) {
          return res.status(429).json({
            error: 'resend_too_soon',
            message: 'Please wait before requesting another code.',
            retryAfterSeconds: Math.ceil((otp.RESEND_SECONDS * 1000 - age) / 1000)
          });
        }
      }

      const id = crypto.randomUUID();
      const code = otp.newCode();
      const codeHash = otp.hashChallenge(code, id, phone, purpose);

      await otp.sendOtp(phone, code, purpose);

      const { error: insertError } = await db.from('phone_otp_challenges').insert({
        id: id,
        phone_e164: phone,
        purpose: purpose,
        code_hash: codeHash,
        attempts: 0,
        max_attempts: otp.MAX_ATTEMPTS,
        expires_at: new Date(Date.now() + otp.OTP_TTL_SECONDS * 1000).toISOString(),
        last_sent_at: new Date().toISOString(),
        resend_count: 1
      });
      if (insertError) return dbFailure(res, insertError, 'create otp challenge');

      return res.json({
        ok: true,
        channel: otp.providerName(),
        maskedPhone: otp.maskPhone(phone),
        expiresInSeconds: otp.OTP_TTL_SECONDS,
        resendAfterSeconds: otp.RESEND_SECONDS
      });
    } catch (e) {
      return sendErr(res, e);
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Verify an OTP. Returns a short-lived signed token, never the code.
  // ---------------------------------------------------------------------------
  app.post('/api/auth/otp/verify', async (req, res) => {
    const db = requireDb(res);
    if (!db) return;
    try {
      const phone = otp.normalizePhone(req.body && req.body.phone);
      if (!phone) return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid Malawian number.' });
      const purpose = cleanText(req.body && req.body.purpose, 16);
      const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
      if (purpose !== 'register' && purpose !== 'reset') {
        return res.status(400).json({ error: 'invalid_purpose', message: 'Invalid verification purpose.' });
      }
      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'invalid_code', message: 'Enter the 6-digit code.' });
      }

      const { data: rows, error } = await db.from('phone_otp_challenges')
        .select('*').eq('phone_e164', phone).eq('purpose', purpose)
        .is('consumed_at', null).gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).limit(1);
      if (error) return dbFailure(res, error, 'load otp challenge');
      const challenge = rows && rows[0];
      if (!challenge) {
        return res.status(400).json({ error: 'invalid_or_expired', message: 'Code expired or already used. Request a new one.' });
      }
      if (Number(challenge.attempts) >= Number(challenge.max_attempts || otp.MAX_ATTEMPTS)) {
        return res.status(429).json({ error: 'too_many_attempts', message: 'Too many incorrect codes. Request a new one.' });
      }

      const expected = otp.hashChallenge(code, challenge.id, challenge.phone_e164, challenge.purpose);
      const a = Buffer.from(String(challenge.code_hash), 'hex');
      const b = Buffer.from(expected, 'hex');
      const match = a.length === b.length && a.length === 32 && crypto.timingSafeEqual(a, b);

      if (!match) {
        const attempts = Number(challenge.attempts || 0) + 1;
        await db.from('phone_otp_challenges').update({ attempts: attempts }).eq('id', challenge.id);
        return res.status(400).json({
          error: 'invalid_code',
          message: 'That code is not right. Check the message and try again.',
          attemptsLeft: Math.max(0, Number(challenge.max_attempts || otp.MAX_ATTEMPTS) - attempts)
        });
      }

      await db.from('phone_otp_challenges')
        .update({ consumed_at: new Date().toISOString(), attempts: Number(challenge.attempts || 0) + 1 })
        .eq('id', challenge.id);

      const token = otp.issueToken({ phone: phone, purpose: purpose, cid: challenge.id }, SERVICE_KEY);
      return res.json({ ok: true, verificationToken: token, expiresInSeconds: otp.TOKEN_TTL_SECONDS });
    } catch (e) {
      return sendErr(res, e);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Complete passenger registration (customer role only).
  // ---------------------------------------------------------------------------
  app.post('/api/auth/register', async (req, res) => {
    const db = requireDb(res);
    if (!db) return;
    try {
      const b = req.body || {};
      const phone = otp.normalizePhone(b.phone);
      if (!phone) return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid Malawian number.' });

      const payload = verifyToken(b.verificationToken, phone, 'register');
      const challenge = await unconsumedChallenge(db, payload, phone, 'register');

      const fullName = cleanText(b.fullName, 100);
      if (fullName.length < 2) return res.status(400).json({ error: 'invalid_name', message: 'Enter your full name.' });
      const password = String(b.password || '');
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: 'invalid_password', message: 'Password must be at least 8 characters.' });
      }
      const emailInput = cleanText(b.email, 180).toLowerCase();
      if (emailInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
        return res.status(400).json({ error: 'invalid_email', message: 'That email address does not look right.' });
      }
      if (b.termsAccepted !== true || b.privacyAccepted !== true) {
        return res.status(400).json({ error: 'consent_required', message: 'Please accept the Terms and Privacy Policy.' });
      }
      const photo = otp.parsePhoto(b.photoDataUrl);

      const { data: duplicate, error: dupError } = await db.from('profiles')
        .select('id').eq('phone_e164', phone).maybeSingle();
      if (dupError) return dbFailure(res, dupError, 'register duplicate check');
      if (duplicate) return res.status(409).json({ error: 'account_exists', message: 'An account already uses this number. Sign in instead.' });

      const fallbackEmail = phone.replace(/\D/g, '') + '@phone.kabaza.local';
      const authEmail = emailInput || fallbackEmail;

      const city = cleanText(b.city, 80) || 'Salima';
      const created = await db.auth.admin.createUser({
        email: authEmail,
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          phone: phone,
          phone_e164: phone,
          city: city,
          registration_channel: 'phone_otp'
        }
      });
      if (created.error || !created.data || !created.data.user) {
        const message = created.error && created.error.message ? created.error.message : '';
        if (/already|exists|duplicate|registered/i.test(message)) {
          return res.status(409).json({ error: 'account_exists', message: 'An account already uses that email address. Sign in instead.' });
        }
        console.error('[KABAZA] auth user create failed:', message);
        return res.status(502).json({ error: 'account_create_failed', message: 'Could not create your account. Please try again.' });
      }
      const user = created.data.user;

      const now = new Date().toISOString();
      const { error: profileError } = await db.from('profiles').update({
        full_name: fullName,
        phone: phone,
        phone_e164: phone,
        phone_verified_at: now,
        terms_accepted_at: now,
        registration_channel: 'phone_otp',
        city: city
      }).eq('id', user.id);
      if (profileError) return dbFailure(res, profileError, 'update registered profile');

      let photoWarning = null;
      if (photo) {
        const path = `${user.id}/profile.${photo.ext}`;
        const upload = await db.storage.from('avatars').upload(path, photo.buffer, {
          contentType: photo.mime,
          upsert: true,
          cacheControl: '3600'
        });
        if (upload.error) {
          console.warn('[KABAZA] avatar upload skipped:', upload.error.message);
          photoWarning = 'Account created, but the photo could not be uploaded. You can add it later in your profile.';
        } else {
          const publicUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
          await db.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id);
        }
      }

      await db.from('phone_otp_challenges').update({ token_used_at: new Date().toISOString() }).eq('id', challenge.id);
      const session = await passwordSession(authEmail, password);

      return res.status(201).json({
        ok: true,
        userId: user.id,
        email: authEmail,
        usedPhoneIdentity: !emailInput,
        photoWarning: photoWarning,
        session: session
      });
    } catch (e) {
      return sendErr(res, e);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Phone + password login (for accounts created without a real email).
  // ---------------------------------------------------------------------------
  app.post('/api/auth/login', async (req, res) => {
    const db = requireDb(res);
    if (!db) return;
    try {
      const phone = otp.normalizePhone(req.body && req.body.phone);
      const password = String((req.body && req.body.password) || '');
      if (!phone || !password) {
        return res.status(400).json({ error: 'invalid_credentials', message: 'Enter your phone number and password.' });
      }
      const account = await userForPhone(db, phone);
      if (!account) {
        // Same message for unknown number and wrong password.
        return res.status(401).json({ error: 'invalid_credentials', message: 'Wrong phone number or password.' });
      }
      const session = await passwordSession(account.user.email, password);
      return res.json({ ok: true, session: session, userId: account.user.id });
    } catch (e) {
      if (e instanceof otp.OtpError && e.code === 'sign_in_failed') {
        return res.status(401).json({ error: 'invalid_credentials', message: 'Wrong phone number or password.' });
      }
      return sendErr(res, e);
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Password recovery with a phone OTP — no email inbox required.
  // ---------------------------------------------------------------------------
  app.post('/api/auth/reset-password', async (req, res) => {
    const db = requireDb(res);
    if (!db) return;
    try {
      const b = req.body || {};
      const phone = otp.normalizePhone(b.phone);
      if (!phone) return res.status(400).json({ error: 'invalid_phone', message: 'Enter a valid Malawian number.' });
      const payload = verifyToken(b.verificationToken, phone, 'reset');
      const challenge = await unconsumedChallenge(db, payload, phone, 'reset');

      const password = String(b.newPassword || '');
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: 'invalid_password', message: 'Password must be at least 8 characters.' });
      }
      const account = await userForPhone(db, phone);
      if (!account) return res.status(404).json({ error: 'account_not_found', message: 'No account found for that number.' });

      const updated = await db.auth.admin.updateUserById(account.user.id, { password: password });
      if (updated.error) {
        console.error('[KABAZA] password reset failed:', updated.error.message);
        return res.status(502).json({ error: 'reset_failed', message: 'Could not reset your password. Please try again.' });
      }
      await db.from('phone_otp_challenges').update({ token_used_at: new Date().toISOString() }).eq('id', challenge.id);
      return res.json({ ok: true, message: 'Password updated. You can sign in now.' });
    } catch (e) {
      return sendErr(res, e);
    }
  });
};
