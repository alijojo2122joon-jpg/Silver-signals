import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// HesabPay webhook receiver. Register this URL in the HesabPay portal (Developer profile → Webhooks),
// events payment_success and payment_failure. Every notification is verified with HesabPay's
// verify-signature endpoint before anything changes; duplicates are ignored by payment / transaction id.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let ev: any; try { ev = await req.json(); } catch { return json({ success: false, error: "bad_json" }, 400); }
  if (ev?.type === "webhook.validation") return json({ success: true });     // portal reachability test

  const key = Deno.env.get("HESABPAY_API_KEY");
  if (!key) return json({ success: false, error: "not_configured" }, 503);
  const base = (Deno.env.get("HESABPAY_ENV") ?? "sandbox") === "production" ? "https://api.hesab.com" : "https://api-sandbox.hesab.com";

  // 1) verify the signature with HesabPay
  let valid = false;
  try {
    const v = await fetch(base + "/api/v1/hesab/webhooks/verify-signature", { method: "POST", headers: { "Authorization": "API-KEY " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ signature: ev?.signature, timestamp: ev?.timestamp }), signal: AbortSignal.timeout(15000) });
    const vj: any = await v.json().catch(() => ({}));
    valid = v.ok && vj?.success === true;
  } catch { valid = false; }
  if (!valid) return json({ success: false, error: "invalid_signature" }, 401);   // HesabPay retries; nothing was changed

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const payId = String(ev?.user_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(payId)) return json({ success: true, ignored: "unknown_reference" });
  const raw = { ...ev, signature: undefined };

  if (ev?.success === true) {
    const amount = ev?.amount != null ? Number(ev.amount) : null;
    const { data, error } = await admin.rpc("activate_payment", { p_id: payId, p_tx: ev?.transaction_id ? String(ev.transaction_id) : null, p_amount: amount, p_raw: raw });
    if (error) return json({ success: false, error: error.message }, 500);   // retry later
    return json({ success: true, result: data });
  }
  await admin.from("payments").update({ status: "failed", raw }).eq("id", payId).eq("status", "pending");
  return json({ success: true, result: "failed_recorded" });
});
