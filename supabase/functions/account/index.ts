import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Sensitive account changes for the ADMIN's own account (members cannot change their email or password; only the admin
// does that for them, through manage-members). Every action re-checks the CURRENT password first (security confirmation):
//  - email:    change the sign-in email
//  - password: change the password (leaked passwords are refused)
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

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
  const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(tok);
  const user = u?.user; if (!user?.email) return json({ error: "unauthorized" }, 401);
  const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (prof?.role !== "admin") return json({ error: "admin_only" }, 403);
  let b: Record<string, unknown> = {}; try { b = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const password = String(b.password ?? "");
  // security confirmation: the current password must be right (separate client; the extra session is signed out right away)
  const probe = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: pe } = await probe.auth.signInWithPassword({ email: user.email, password });
  if (pe || !s?.session) return json({ error: "wrong_password" }, 400);
  try { await admin.auth.admin.signOut(s.session.access_token, "local"); } catch { /* ignore */ }

  if (b.action === "email") {
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) || email.length > 120) return json({ error: "email" }, 400);
    const { error } = await admin.auth.admin.updateUserById(user.id, { email, email_confirm: true });
    if (error) return json({ error: /already|exists|registered/i.test(error.message) ? "email_exists" : "failed" }, 400);
    await admin.from("profiles").update({ email }).eq("id", user.id);
    return json({ ok: true });
  }
  if (b.action === "password") {
    const np = String(b.new_password ?? "");
    if (np.length < 8) return json({ error: "weak_password" }, 400);
    if (await pwned(np)) return json({ error: "pwned_password" }, 400);
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: np });
    if (error) return json({ error: "failed" }, 400);
    return json({ ok: true });
  }
  return json({ error: "unknown_action" }, 400);
});
