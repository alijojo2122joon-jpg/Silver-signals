// Access gate for the edge functions.
//  - scheduled jobs (pg_cron via private.call_fn) send the shared key in "x-cron-key"
//  - the apps send the signed-in user's token; public.am_i() says if it is the admin or an active member
// A copy of this file sits next to every function that uses it (the deploy bundles each folder on its own).
import { createClient } from "npm:@supabase/supabase-js@2";

export type Who = { admin: boolean; member: boolean; cron: boolean };
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
let ck: { v: string; t: number } | null = null;
const seen = new Map<string, { r: Who; t: number }>();
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

export async function cronKey(admin: any): Promise<string> {
  if (!ck || Date.now() - ck.t > 300_000) { const { data } = await admin.rpc("cron_key"); ck = { v: String(data || ""), t: Date.now() }; }
  return ck.v;
}

export async function who(req: Request, admin: any): Promise<Who> {
  const k = req.headers.get("x-cron-key");
  if (k) { const v = await cronKey(admin); if (v && same(k, v)) return { admin: false, member: false, cron: true }; }
  const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const none: Who = { admin: false, member: false, cron: false };
  if (tok.split(".").length !== 3) return none;
  const c = seen.get(tok); if (c && Date.now() - c.t < 60_000) return c.r;
  let r = none;
  try {
    const cl = createClient(URL_, ANON, { global: { headers: { Authorization: "Bearer " + tok } }, auth: { persistSession: false } });
    const { data } = await cl.rpc("am_i");
    if (data) r = { admin: !!data.admin, member: !!data.member, cron: false };
  } catch { /* deny */ }
  if (seen.size > 1000) seen.clear();
  seen.set(tok, { r, t: Date.now() });
  return r;
}

export const denied = (cors: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
