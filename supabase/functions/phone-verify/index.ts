// Phone verification for Personals.
// Flow: Twilio Lookup (reject VoIP/landline) -> Twilio Verify (send/check SMS OTP)
// -> record verification (service role). No external imports (fast, reliable deploys).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TW_VERIFY = Deno.env.get("TWILIO_VERIFY_SERVICE_SID") ?? "";
const DEFAULT_COUNTRY = Deno.env.get("PHONE_DEFAULT_COUNTRY") ?? "US";

// Carrier line types we refuse. Twilio line_type_intelligence values.
const BLOCKED_LINE_TYPES = new Set(["voip", "fixedVoip", "nonFixedVoip"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const twAuth = () => "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`);

async function getUser(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return null;
  return await r.json();
}

async function lookup(raw: string, withType: boolean) {
  const fields = withType ? "&Fields=line_type_intelligence" : "";
  const r = await fetch(
    `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(raw)}?CountryCode=${DEFAULT_COUNTRY}${fields}`,
    { headers: { Authorization: twAuth() } },
  );
  return { ok: r.ok, data: await r.json() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!TW_SID || !TW_TOKEN || !TW_VERIFY) {
    return json({ error: "Phone verification isn't configured yet." }, 503);
  }

  const user = await getUser(req);
  if (!user || !user.id) return json({ error: "You must be logged in." }, 401);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  // -------- start: validate number, block VoIP, send SMS code --------
  if (p.action === "start") {
    const raw = String(p.phone || "").trim();
    if (!raw) return json({ error: "Enter a phone number." }, 400);

    const { ok, data } = await lookup(raw, true);
    if (!ok || data.valid === false) {
      return json({ error: "That doesn't look like a valid phone number." }, 400);
    }
    const e164 = data.phone_number as string;
    const lineType = data.line_type_intelligence?.type ?? null;
    if (lineType && BLOCKED_LINE_TYPES.has(lineType)) {
      return json({
        error: "VoIP / internet phone numbers aren't allowed. Please verify with a real mobile number.",
        code: "voip_blocked",
      }, 422);
    }

    // One phone per account
    const chk = await fetch(
      `${SUPABASE_URL}/rest/v1/phone_verifications?phone_e164=eq.${encodeURIComponent(e164)}&select=user_id`,
      { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
    );
    const existing = await chk.json();
    if (Array.isArray(existing) && existing.length && existing[0].user_id !== user.id) {
      return json({ error: "That number is already linked to another account.", code: "phone_taken" }, 409);
    }

    const vr = await fetch(`https://verify.twilio.com/v2/Services/${TW_VERIFY}/Verifications`, {
      method: "POST",
      headers: { Authorization: twAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: e164, Channel: "sms" }),
    });
    const vd = await vr.json();
    if (!vr.ok) return json({ error: vd.message || "Couldn't send the code. Try again." }, 400);
    return json({ ok: true, sent: true, phone: e164, line_type: lineType });
  }

  // -------- check: verify code, record verification --------
  if (p.action === "check") {
    const raw = String(p.phone || "").trim();
    const code = String(p.code || "").trim();
    if (!raw || !code) return json({ error: "Enter the code we texted you." }, 400);

    const { ok, data } = await lookup(raw, false); // basic (free) normalization
    const e164 = (ok && data.phone_number) ? data.phone_number : raw;

    const vr = await fetch(`https://verify.twilio.com/v2/Services/${TW_VERIFY}/VerificationCheck`, {
      method: "POST",
      headers: { Authorization: twAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: e164, Code: code }),
    });
    const vd = await vr.json();
    if (!vr.ok || vd.status !== "approved") {
      return json({ error: "That code is incorrect or expired.", code: "bad_code" }, 400);
    }

    const up = await fetch(`${SUPABASE_URL}/rest/v1/phone_verifications`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ user_id: user.id, phone_e164: e164, verified_at: new Date().toISOString() }),
    });
    if (!up.ok) return json({ error: "Could not save verification." }, 500);

    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify({ phone_verified: true }),
    });
    return json({ ok: true, verified: true });
  }

  return json({ error: "Unknown action." }, 400);
});
