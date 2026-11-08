import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Creates a HesabPay hosted-checkout session for a subscription plan.
// Secrets: HESABPAY_API_KEY (required), HESABPAY_ENV = "sandbox" | "production" (default sandbox), SITE_URL (return pages).
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return json({ error: "unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("role,disabled,deleted_at,email").eq("id", u.user.id).maybeSingle();
  if (!prof || prof.role !== "member" || prof.deleted_at) return json({ error: "forbidden" }, 403);

  const key = Deno.env.get("HESABPAY_API_KEY");
  if (!key) return json({ error: "gateway_not_configured" }, 503);
  const base = (Deno.env.get("HESABPAY_ENV") ?? "sandbox") === "production" ? "https://api.hesab.com" : "https://api-sandbox.hesab.com";
  const site = (Deno.env.get("SITE_URL") ?? "https://alijojo2122joon-jpg.github.io/Silver-signals").replace(/\/+$/, "");

  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const { data: plan } = await admin.from("plans").select("*").eq("id", Number(body.plan_id)).eq("active", true).maybeSingle();
  if (!plan) return json({ error: "plan_not_found" }, 404);

  // one open checkout at a time: expire older pending ones of this user
  await admin.from("payments").update({ status: "expired" }).eq("user_id", u.user.id).eq("status", "pending").lt("created_at", new Date(Date.now() - 20 * 60_000).toISOString());
  const { data: pay, error } = await admin.from("payments").insert({ user_id: u.user.id, plan_id: plan.id, plan_code: plan.grants, months: plan.months, amount_afn: plan.price_afn }).select("id").single();
  if (error || !pay) return json({ error: "db", detail: error?.message }, 500);

  const r = await fetch(base + "/api/v1/payment/create-session", {
    method: "POST", headers: { "Authorization": "API-KEY " + key, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ email: prof.email || u.user.email || undefined, user_id: pay.id,
      items: [{ id: plan.code, name: plan.name_fa, price: Number(plan.price_afn) }],
      redirect_success_url: `${site}/index.html?pay=ok&p=${pay.id}`, redirect_failure_url: `${site}/index.html?pay=fail&p=${pay.id}` }),
    signal: AbortSignal.timeout(20000) }).catch(e => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) } as any));
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) {
    await admin.from("payments").update({ status: "failed", raw: { create: j, http: r.status } }).eq("id", pay.id);
    return json({ error: "gateway_error", status: r.status, message: j?.message ?? null }, 502);
  }
  await admin.from("payments").update({ session_id: j.session_id ?? null, checkout_url: j.url, raw: { create: { expires_at: j.expires_at } } }).eq("id", pay.id);
  return json({ url: j.url, payment_id: pay.id, expires_at: j.expires_at ?? null });
});
