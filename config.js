// Public client configuration. The publishable key is designed to ship in browser code —
// what it can reach is limited by the row-level-security rules in supabase/schema.sql.
// Never put a secret key (sb_secret_… or service_role) in this file.
window.POS_CONFIG = {
  SUPABASE_URL: 'https://npxvcedbesevknnxnuwf.supabase.co',
  SUPABASE_KEY: 'sb_publishable_4VD9EcRGx6wStXB7m3fe1Q_RjKTk83Y',
  BUCKET: 'sample-images'
};
