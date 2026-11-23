// KABAZA public configuration.
// Safe to expose in the app. NEVER put the Supabase service_role key or the
// PayChangu secret key here — those live only in server/.env.
(function () {
  'use strict';

  window.KBZ_CONFIG = {
    appName: 'KABAZA',
    currency: 'MWK',
    country: 'Malawi',

    // Paste your new KABAZA Supabase project URL and anon/publishable key here.
    // Leave supabaseUrl empty to run the full app in local demo mode.
    supabaseUrl: 'https://lireychwvpdqrbhxocka.supabase.co',
    supabaseAnonKey: 'sb_publishable_sMKyFv0R4DlOwjD4MxNM_Q_Uav6nbNb',

    // Public URL of the KABAZA payments service (server/ on Render).
    // Never put the PayChangu or Supabase secret keys here.
    paymentApiBase: 'https://kabaza-payments.onrender.com',
    paymentsEnabled: true,

    // Demo role used when Supabase is not configured. Change in the login screen.
    demoRole: 'customer',

    supportPhone: '+265 123 456 789',
    alcoholMinAge: 18,
    version: '1.0.0'
  };
})();
