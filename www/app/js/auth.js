// KABAZA phone-first passenger registration and account recovery.
// This wizard never receives or displays an OTP code. The backend verifies the
// code and hands back a short-lived signed token plus Supabase session tokens.
(function () {
  'use strict';

  var KBZ = window.KBZ || (window.KBZ = {});
  var ui = KBZ.ui;
  var state = null;
  var countdown = null;

  function api(path, payload) {
    var base = String((window.KBZ_CONFIG || {}).paymentApiBase || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) {
      throw new Error('The KABAZA account service is not configured. Please try again later.');
    }
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    return fetch(base + path, {
      method: 'POST',
      signal: controller ? controller.signal : undefined,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (timer) clearTimeout(timer);
        if (!response.ok) {
          var err = new Error(body.message || body.error || 'Request failed. Please try again.');
          err.code = body.error || '';
          err.status = response.status;
          err.info = body;
          throw err;
        }
        return body;
      }, function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        throw new Error('The network timed out. Check your connection and try again.');
      }
      throw e;
    });
  }

  function normalizePhone(raw) {
    var s = String(raw == null ? '' : raw).replace(/[^\d+]/g, '');
    if (s.indexOf('+265') === 0) s = '+' + s.slice(1);
    else if (s.indexOf('265') === 0) s = '+' + s;
    else if (s.indexOf('0') === 0) s = '+265' + s.slice(1);
    else if (s.length === 9) s = '+265' + s;
    else s = '+265' + s;
    var digits = s.slice(4).replace(/\D/g, '');
    return /^\d{9}$/.test(digits) ? '+265' + digits : null;
  }

  function maskPhone(phone) {
    var p = normalizePhone(phone);
    return p ? p.slice(0, 4) + ' *** *** ' + p.slice(-3) : String(phone || '');
  }

  function stopCountdown() {
    if (countdown) { clearInterval(countdown); countdown = null; }
  }

  function startCountdown(seconds, onTick) {
    stopCountdown();
    var left = Math.max(0, Number(seconds) || 0);
    onTick(left);
    countdown = setInterval(function () {
      left -= 1;
      onTick(Math.max(0, left));
      if (left <= 0) stopCountdown();
    }, 1000);
  }

  function shell(opts) {
    var steps = opts.steps || 0;
    var current = opts.step || 0;
    var progress = steps
      ? '<div class="auth-progress"><span>Step ' + (current + 1) + ' of ' + steps + '</span>' +
        '<div class="auth-progress__track"><i style="width:' +
        Math.round(((current + 1) / steps) * 100) + '%"></i></div></div>'
      : '';
    return '<div class="auth-page"><div class="auth-card">' +
      '<a href="../index.html" class="brand"><span class="brand__mark">K</span><span class="brand__word">KABAZA</span></a>' +
      progress +
      (opts.title ? '<h2>' + ui.esc(opts.title) + '</h2>' : '') +
      (opts.subtitle ? '<p class="muted">' + opts.subtitle + '</p>' : '') +
      (opts.error ? '<div class="notice notice--warn">' + ui.esc(opts.error) + '</div>' : '') +
      (opts.body || '') +
      '<p class="auth-foot">Need help? Call ' + ui.esc((window.KBZ_CONFIG || {}).supportPhone || '+265 123 456 789') +
      ' · <a href="../terms.html" target="_blank" rel="noopener">Terms</a> · ' +
      '<a href="../privacy.html" target="_blank" rel="noopener">Privacy</a></p>' +
      '</div></div>';
  }

  function mount(html) {
    var app = document.getElementById('app');
    if (!app) return;
    stopCountdown();
    app.innerHTML = html;
  }

  function showError(message) {
    var old = document.querySelector('.auth-card .notice--warn');
    if (old) old.parentNode.removeChild(old);
    var head = document.querySelector('.auth-card h2');
    if (!head) return;
    var node = document.createElement('div');
    node.className = 'notice notice--warn';
    node.textContent = message;
    head.parentNode.insertBefore(node, head.nextSibling);
  }

  function next(step) {
    state.step = step;
    state.error = null;
    draw();
  }

  // ------------------------------------------------------------- registration
  function drawRegister() {
    var s = state;
    if (s.step === 0) {
      mount(shell({
        steps: 6, step: 0,
        title: 'Welcome to KABAZA',
        subtitle: 'One phone number is all you need to start. We confirm it with a code sent by SMS or WhatsApp — no Gmail account required.',
        body: '<div class="auth-points">' +
          '<div>📱 <span><b>Phone-first</b><small>Your number is your KABAZA identity.</small></span></div>' +
          '<div>🔐 <span><b>Verified & secure</b><small>A one-time code protects your account.</small></span></div>' +
          '<div>🏍 <span><b>Passengers only here</b><small>Riders join through our separate onboarding.</small></span></div>' +
          '</div>' +
          '<button class="btn btn--primary btn--block" id="auth-start">Create my account</button>' +
          '<a class="auth-link" href="#/login">I already have an account</a>'
      }));
      document.getElementById('auth-start').onclick = function () { next(1); };
      return;
    }

    if (s.step === 1) {
      mount(shell({
        steps: 6, step: 1,
        title: 'Your mobile number',
        subtitle: 'This is how your rider contacts you and how we send your verification code.',
        body: '<form id="phone-form">' +
          ui.field('Mobile number', 'phone', {
            type: 'tel', required: true, value: s.phone || '',
            placeholder: '0999 123 456'
          }) +
          '<p class="fineprint">Malawi numbers only. Use 0999… or +265 999…</p>' +
          '<button class="btn btn--primary btn--block" type="submit">Send me a code</button>' +
          '</form><button class="auth-back" id="auth-back">← Back</button>',
        error: s.error
      }));
      document.getElementById('phone-form').onsubmit = async function (e) {
        e.preventDefault();
        var values = ui.formValues(e.target);
        var phone = normalizePhone(values.phone);
        if (!phone) { showError('Enter a valid Malawian number, e.g. 0999 123 456.'); return; }
        var btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          var result = await api('/api/auth/otp/request', { phone: phone, purpose: 'register' });
          s.phone = phone;
          s.channel = result.channel;
          s.resendAfter = result.resendAfterSeconds || 60;
          next(2);
        } catch (err) {
          showError(err.message);
          btn.disabled = false; btn.textContent = 'Send me a code';
        }
      };
      document.getElementById('auth-back').onclick = function () { next(0); };
      return;
    }

    if (s.step === 2) {
      mount(shell({
        steps: 6, step: 2,
        title: 'Check your ' + (s.channel === 'whatsapp' ? 'WhatsApp' : 'messages'),
        subtitle: 'We sent a 6-digit code to <b>' + ui.esc(maskPhone(s.phone)) + '</b>. It expires in 10 minutes. Never share it with anyone.',
        body: '<form id="code-form">' +
          '<label class="field"><span>Verification code</span>' +
          '<input class="input input--code" type="text" name="code" inputmode="numeric" ' +
          'autocomplete="one-time-code" maxlength="6" placeholder="000000" required></label>' +
          '<button class="btn btn--primary btn--block" type="submit">Verify number</button>' +
          '</form>' +
          '<div class="auth-resend"><button class="link-button" id="resend-code" disabled>Resend code</button>' +
          '<span id="resend-note"></span></div>' +
          '<button class="auth-back" id="auth-back">← Change number</button>',
        error: s.error
      }));
      var resendBtn = document.getElementById('resend-code');
      var note = document.getElementById('resend-note');
      startCountdown(s.resendAfter || 60, function (left) {
        if (!resendBtn || !note) return;
        resendBtn.disabled = left > 0;
        note.textContent = left > 0 ? 'Available in ' + left + 's' : '';
      });
      document.getElementById('code-form').onsubmit = async function (e) {
        e.preventDefault();
        var code = String(ui.formValues(e.target).code || '').replace(/\D/g, '');
        if (code.length !== 6) { showError('Enter all 6 digits of the code.'); return; }
        var btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Checking…';
        try {
          var result = await api('/api/auth/otp/verify', { phone: s.phone, purpose: 'register', code: code });
          s.token = result.verificationToken;
          next(3);
        } catch (err) {
          showError(err.message);
          btn.disabled = false; btn.textContent = 'Verify number';
        }
      };
      resendBtn.onclick = async function () {
        resendBtn.disabled = true;
        try {
          await api('/api/auth/otp/request', { phone: s.phone, purpose: 'register' });
          s.error = null;
          startCountdown(s.resendAfter || 60, function (left) {
            resendBtn.disabled = left > 0;
            note.textContent = left > 0 ? 'Available in ' + left + 's' : '';
          });
          ui.toast('A new code is on its way', 'success');
        } catch (err) {
          showError(err.message);
        }
      };
      document.getElementById('auth-back').onclick = function () { next(1); };
      return;
    }

    if (s.step === 3) {
      mount(shell({
        steps: 6, step: 3,
        title: 'A few details',
        subtitle: 'Only what we need to give you a safe ride.',
        body: '<form id="details-form">' +
          ui.field('Full name *', 'fullName', { required: true, value: s.details.fullName || '', placeholder: 'Chisomo Banda' }) +
          ui.field('Email address (optional)', 'email', { type: 'email', value: s.details.email || '', placeholder: 'you@example.com' }) +
          '<p class="fineprint">No email? No problem — your phone number works on its own.</p>' +
          ui.field('Password *', 'password', { type: 'password', required: true, placeholder: 'At least 8 characters' }) +
          ui.field('Confirm password *', 'confirm', { type: 'password', required: true, placeholder: 'Repeat your password' }) +
          ui.field('Town / area', 'city', { value: s.details.city || 'Salima' }) +
          '<button class="btn btn--primary btn--block" type="submit">Continue</button>' +
          '</form><button class="auth-back" id="auth-back">← Back</button>',
        error: s.error
      }));
      document.getElementById('details-form').onsubmit = function (e) {
        e.preventDefault();
        var v = ui.formValues(e.target);
        if (String(v.fullName).trim().length < 2) { showError('Enter your full name.'); return; }
        if (String(v.password).length < 8) { showError('Your password needs at least 8 characters.'); return; }
        if (v.password !== v.confirm) { showError('The two passwords do not match.'); return; }
        s.details = v;
        s.password = v.password;
        next(4);
      };
      document.getElementById('auth-back').onclick = function () { next(2); };
      return;
    }

    if (s.step === 4) {
      mount(shell({
        steps: 6, step: 4,
        title: 'Add a photo (optional)',
        subtitle: 'A clear face photo helps your rider find you at the pickup point. You can skip this and add one later in your profile.',
        body: '<div class="auth-photo">' +
          (s.photoDataUrl ? '<img src="' + ui.esc(s.photoDataUrl) + '" alt="Profile preview">' :
            '<div class="auth-photo__empty">📷<small>No photo selected</small></div>') +
          '<label class="btn btn--ghost btn--block" for="photo-input">Choose a photo</label>' +
          '<input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden>' +
          (s.photoDataUrl ? '<button class="link-button" id="remove-photo">Remove photo</button>' : '') +
          '</div>' +
          '<button class="btn btn--primary btn--block" id="photo-next">' + (s.photoDataUrl ? 'Continue with photo' : 'Skip for now') + '</button>' +
          '<button class="auth-back" id="auth-back">← Back</button>',
        error: s.error
      }));
      document.getElementById('photo-input').onchange = function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { showError('Please choose a photo smaller than 2 MB.'); return; }
        var reader = new FileReader();
        reader.onload = function () { s.photoDataUrl = String(reader.result); draw(); };
        reader.onerror = function () { showError('Could not read that photo. Try another one.'); };
        reader.readAsDataURL(file);
      };
      var remove = document.getElementById('remove-photo');
      if (remove) remove.onclick = function () { s.photoDataUrl = ''; draw(); };
      document.getElementById('photo-next').onclick = function () { next(5); };
      document.getElementById('auth-back').onclick = function () { next(3); };
      return;
    }

    // Consent + review
    mount(shell({
      steps: 6, step: 5,
      title: 'Ready to ride',
      subtitle: 'Check your details, then accept the terms to finish.',
      body: '<div class="auth-review">' +
        '<div><span>Phone</span><b>' + ui.esc(maskPhone(s.phone)) + '</b></div>' +
        '<div><span>Name</span><b>' + ui.esc(s.details.fullName || '') + '</b></div>' +
        '<div><span>Email</span><b>' + ui.esc(s.details.email || 'Not provided') + '</b></div>' +
        '<div><span>Town</span><b>' + ui.esc(s.details.city || 'Salima') + '</b></div>' +
        '<div><span>Photo</span><b>' + (s.photoDataUrl ? 'Added' : 'Not added') + '</b></div>' +
        '</div>' +
        '<label class="check-row"><input type="checkbox" name="terms" id="accept-terms">' +
        '<span>I accept the <a href="../terms.html" target="_blank" rel="noopener">Terms & Conditions</a>.</span></label>' +
        '<label class="check-row"><input type="checkbox" name="privacy" id="accept-privacy">' +
        '<span>I have read the <a href="../privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>' +
        '<p class="fineprint">We never ask ordinary passengers for a national ID or passport. Riders have a separate verification process.</p>' +
        '<button class="btn btn--primary btn--block" id="finish-register">Create my account</button>',
      error: s.error
    }));
    document.getElementById('finish-register').onclick = async function (e) {
      if (!document.getElementById('accept-terms').checked ||
          !document.getElementById('accept-privacy').checked) {
        showError('Please accept both the Terms and the Privacy Policy.');
        return;
      }
      var btn = e.target;
      btn.disabled = true; btn.textContent = 'Creating account…';
      try {
        var result = await api('/api/auth/register', {
          phone: s.phone,
          fullName: s.details.fullName,
          email: s.details.email || '',
          password: s.password,
          city: s.details.city || 'Salima',
          photoDataUrl: s.photoDataUrl || '',
          termsAccepted: true,
          privacyAccepted: true,
          verificationToken: s.token
        });
        var session = await KBZ.db.setSessionFromTokens(result.session.accessToken, result.session.refreshToken);
        KBZ.app.setSession(session);
        if (KBZ.permissions) {
          KBZ.permissions.ensureLocation().catch(function (e) {
            console.warn('[KABAZA] location permission prompt skipped', e);
          });
        }
        ui.toast('Welcome to KABAZA!', 'success');
        if (result.photoWarning) ui.toast(result.photoWarning, 'error');
        location.hash = '#/home';
        KBZ.router.resolve();
      } catch (err) {
        showError(err.message);
        btn.disabled = false; btn.textContent = 'Create my account';
      }
    };
  }

  // ------------------------------------------------------------------ recovery
  function drawRecover() {
    var s = state;
    if (s.step === 0) {
      mount(shell({
        steps: 3, step: 0,
        title: 'Reset your password',
        subtitle: 'Enter the phone number on your KABAZA account. We will send a code to confirm it is you.',
        body: '<form id="recover-phone">' +
          ui.field('Mobile number', 'phone', { type: 'tel', required: true, value: s.phone || '', placeholder: '0999 123 456' }) +
          '<button class="btn btn--primary btn--block" type="submit">Send code</button>' +
          '</form><a class="auth-link" href="#/login">← Back to sign in</a>',
        error: s.error
      }));
      document.getElementById('recover-phone').onsubmit = async function (e) {
        e.preventDefault();
        var phone = normalizePhone(ui.formValues(e.target).phone);
        if (!phone) { showError('Enter a valid Malawian number.'); return; }
        var btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          await api('/api/auth/otp/request', { phone: phone, purpose: 'reset' });
          s.phone = phone;
          next(1);
        } catch (err) {
          showError(err.message);
          btn.disabled = false; btn.textContent = 'Send code';
        }
      };
      return;
    }

    if (s.step === 1) {
      mount(shell({
        steps: 3, step: 1,
        title: 'Choose a new password',
        subtitle: 'Code sent to <b>' + ui.esc(maskPhone(s.phone)) + '</b>. It expires in 10 minutes.',
        body: '<form id="reset-form">' +
          '<label class="field"><span>Verification code</span>' +
          '<input class="input input--code" type="text" name="code" inputmode="numeric" maxlength="6" placeholder="000000" required></label>' +
          ui.field('New password', 'password', { type: 'password', required: true, placeholder: 'At least 8 characters' }) +
          ui.field('Confirm new password', 'confirm', { type: 'password', required: true }) +
          '<button class="btn btn--primary btn--block" type="submit">Update password</button>' +
          '</form><button class="auth-back" id="auth-back">← Change number</button>',
        error: s.error
      }));
      document.getElementById('reset-form').onsubmit = async function (e) {
        e.preventDefault();
        var v = ui.formValues(e.target);
        var code = String(v.code || '').replace(/\D/g, '');
        if (code.length !== 6) { showError('Enter all 6 digits of the code.'); return; }
        if (String(v.password).length < 8) { showError('Your password needs at least 8 characters.'); return; }
        if (v.password !== v.confirm) { showError('The two passwords do not match.'); return; }
        var btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Updating…';
        try {
          var verified = await api('/api/auth/otp/verify', { phone: s.phone, purpose: 'reset', code: code });
          await api('/api/auth/reset-password', {
            phone: s.phone, verificationToken: verified.verificationToken, newPassword: v.password
          });
          next(2);
        } catch (err) {
          showError(err.message);
          btn.disabled = false; btn.textContent = 'Update password';
        }
      };
      document.getElementById('auth-back').onclick = function () { next(0); };
      return;
    }

    mount(shell({
      steps: 3, step: 2,
      title: 'Password updated',
      subtitle: 'You can sign in now with your phone number and new password.',
      body: '<a class="btn btn--primary btn--block" href="#/login">Sign in</a>'
    }));
  }

  function draw() {
    if (!state) return;
    if (state.mode === 'recover') drawRecover();
    else drawRegister();
  }

  KBZ.auth = {
    register: function () {
      stopCountdown();
      state = { mode: 'register', step: 0, phone: '', token: '', details: {}, photoDataUrl: '', error: null };
      draw();
    },
    recover: function () {
      stopCountdown();
      state = { mode: 'recover', step: 0, phone: '', error: null };
      draw();
    },
    normalizePhone: normalizePhone
  };
})();
