import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPush } from "./webpush.js";

// Called by the notifications insert trigger (pg_net) with a shared secret. Sends Web Push to every
// subscribed device of the notification's recipients and removes expired subscriptions (404/410).
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await admin.rpc("push_config");
  if (!cfg?.hook || req.headers.get("x-push-hook") !== cfg.hook) return json({ error: "forbidden" }, 403);
  let id = 0; try { id = Number((await req.json()).id); } catch { /* */ }
  const { data: n } = await admin.from("notifications").select("id,kind,title,body,data").eq("id", id).maybeSingle();
  if (!n) return json({ error: "not_found" }, 404);
  const { data: subs } = await admin.rpc("push_targets", { p_notif: id });
  const url = n.kind === "chat" ? "./index.html?chat=1" : n.kind === "signal" ? "./index.html?pg=sig" : n.kind === "payment" ? "./modir.html" : "./index.html?notifs=1";
  const payload = JSON.stringify({ title: n.title, body: n.body || "", tag: n.kind + "-" + (n.data?.signal_id ?? n.id), url, kind: n.kind });
  const vapid = { pub: cfg.pub, priv: cfg.priv, subject: "https://alijojo2122joon-jpg.github.io/Silver-signals/" };
  let sent = 0, gone = 0, fail = 0;
  await Promise.all((subs || []).map(async (s: any) => {
    try { const st = await sendPush(s, payload, vapid);
      if (st === 404 || st === 410) { gone++; await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint); } else if (st >= 200 && st < 300) sent++; else fail++;
    } catch { fail++; } }));
  return json({ sent, gone, fail });
});
