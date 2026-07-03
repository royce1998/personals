// Supabase connection for the browser (publishable key is safe to expose;
// all access is protected by row-level security). Setting these enables the
// shared, multi-user backend. Remove/blank them to fall back to local mode.
window.SUPABASE_URL = 'https://lxiplydivrtjrrvcpclr.supabase.co';
window.SUPABASE_KEY = 'sb_publishable_0m3hiM52iihIm3oqXm1z6A_7vFfd3Xz';

// Require a verified (non-VoIP) phone number before users can post/reply.
// Keep false until an SMS provider (Twilio) is configured, otherwise nobody
// can post. Flip to true once phone verification is live.
window.REQUIRE_PHONE_VERIFICATION = false;
