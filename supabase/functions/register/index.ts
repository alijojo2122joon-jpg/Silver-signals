import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public self sign-up. Creates an account that is NOT active yet (subscription ends "now"):
// the new member signs in, picks a plan, pays (Binance / HesabPay) and sends the receipt; the admin approves it.
// Protection: honeypot field, per-IP + daily limits and an on/off switch (public.signup_gate), leaked-password check.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const en = (s: unknown) => String(s ?? "").replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).trim();
const clip = (s: unknown, n: number) => { const v = String(s ?? "").trim().replace(/\s+/g, " ").slice(0, n); return v || null; };

async function pwned(pw: string): Promise<boolean> {
  try {
    const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(pw)))).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const r = await fetch("https://api.pwnedpasswords.com/range/" + h.slice(0, 5), { headers: { "Add-Padding": "true", "User-Agent": "MarketAnalysts" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return false;
    const rest = h.slice(5);
    return (await r.text()).split("\n").some(l => { const [suf, cnt] = l.trim().split(":"); return suf === rest && Number(cnt) > 0; });
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  if (b.website) return json({ ok: true }); // honeypot: bots fill every field

  const name = clip(b.name, 80), email = en(b.email).toLowerCase(), password = String(b.password ?? "");
  const phone = clip(en(b.phone).replace(/[^\d+]/g, ""), 20), whatsapp = clip(en(b.whatsapp).replace(/[^\d+]/g, ""), 20);
  const city = clip(b.city, 60), country = clip(b.country, 60), telegram = clip(en(b.telegram).replace(/^@/, ""), 60);
  if (!name || name.length < 2) return json({ error: "name" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 120) return json({ error: "email" }, 400);
  if (password.length < 8) return json({ error: "weak_password" }, 400);
  if (!phone || phone.replace(/\D/g, "").length < 7) return json({ error: "phone" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "?").split(",")[0].trim();
  const { data: gate } = await admin.rpc("signup_gate", { p_ip: ip });
  if (gate === "closed") return json({ error: "closed" }, 403);
  if (gate !== "ok") return json({ error: "rate" }, 429);
  if (await pwned(password)) return json({ error: "pwned_password" }, 400);

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error) return json({ error: /already|exists|registered/i.test(error.message) ? "email_exists" : "create_failed" }, 400);
  const { error: e2 } = await admin.from("profiles").insert({ id: data.user.id, role: "member", name, email, phone, whatsapp: whatsapp ?? phone, telegram, city, country,
    expires_at: new Date().toISOString(), self_signup: true });
  if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: "create_failed" }, 400); }
  await admin.rpc("notify_signup", { p_user: data.user.id });
  return json({ ok: true });
});
