import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { who, denied } from "./gate.ts";

// Live price relay. Started every minute by pg_cron; each run lives ~57 s and pushes every price change to the
// private Realtime topic "prices" (only active members and the admin can join it), so the apps update instantly
// without polling. Sources (each quote keeps its own source time, so the apps can show the real delay):
//   - Tiingo FX WebSocket with bid/ask, when the admin has saved a licensed Tiingo key
//   - gold-api.com spot for gold, silver, platinum, palladium
//   - Yahoo Finance quotes for FX pairs, the dollar index, stock indices and energy
// Crypto is streamed by the apps straight from Binance's public WebSocket.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const URL_ = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "application/json" };
const RUN_MS = 57_000;

// symbol -> Yahoo symbol. Group A refreshes every 2 s, group B every 6 s.
const YA: Record<string, string> = { EURUSD: "EURUSD=X", GBPUSD: "GBPUSD=X", USDJPY: "USDJPY=X", USDCHF: "USDCHF=X", AUDUSD: "AUDUSD=X", USDCAD: "USDCAD=X", NZDUSD: "NZDUSD=X", DXY: "DX-Y.NYB", WTI: "CL=F", BRENT: "BZ=F" };
const YB: Record<string, string> = { EURGBP: "EURGBP=X", EURJPY: "EURJPY=X", GBPJPY: "GBPJPY=X", EURCHF: "EURCHF=X", EURAUD: "EURAUD=X", EURCAD: "EURCAD=X", AUDJPY: "AUDJPY=X",
  CADJPY: "CADJPY=X", CHFJPY: "CHFJPY=X", NZDJPY: "NZDJPY=X", GBPCHF: "GBPCHF=X", GBPAUD: "GBPAUD=X", AUDCAD: "AUDCAD=X", AUDNZD: "AUDNZD=X",
  USDTRY: "USDTRY=X", USDCNH: "USDCNH=X", USDINR: "USDINR=X", USDPKR: "USDPKR=X", USDAED: "USDAED=X",
  US500: "^GSPC", NAS100: "^NDX", US30: "^DJI", GER40: "^GDAXI", NGAS: "NG=F", COPPER: "HG=F",
  _XAU: "GC=F", _XAG: "SI=F", _XPT: "PL=F", _XPD: "PA=F" };  // "_" = only used for the metals' previous close until our own daily open exists
const METALS = ["XAU", "XAG", "XPT", "XPD"];
const TIINGO = ["eurusd", "gbpusd", "usdjpy", "usdchf", "audusd", "usdcad", "nzdusd", "eurgbp", "eurjpy", "gbpjpy", "eurchf", "audjpy", "xauusd", "xagusd"];

type Q = { p: number; b: number | null; a: number | null; t: number; pc: number | null; src: string };
const st: Record<string, Q> = {};
const dirty = new Set<string>();
const prevClose: Record<string, number> = {};
// metals have no "previous close" in the spot feed: we keep our own daily open at the 22:00 UTC market rollover
let dayOpen: Record<string, number> = {}, dayKey = "";
const tradingDay = () => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);

function put(sym: string, p: number, t: number, src: string, b: number | null = null, a: number | null = null, pc: number | null = null) {
  if (!isFinite(p) || p <= 0) return;
  const o = st[sym];
  if (o && t < o.t) return;                         // never go back to an older quote
  if (o && o.src === "tiingo" && src !== "tiingo" && Date.now() - o.t < 30_000) return; // licensed bid/ask wins while fresh
  if (pc != null) prevClose[sym] = pc;
  const n: Q = { p, b, a, t, pc: prevClose[sym] ?? o?.pc ?? null, src };
  if (o && o.p === n.p && o.b === n.b && o.a === n.a) { o.t = t; return; }
  st[sym] = n; dirty.add(sym);
}

async function yahoo(map: Record<string, string>) {
  const ent = Object.entries(map); if (ent.length > 15) { const jobs = []; for (let i = 0; i < ent.length; i += 15) jobs.push(yahoo(Object.fromEntries(ent.slice(i, i + 15)))); await Promise.all(jobs); return; }
  const inv: Record<string, string> = {}; for (const [k, v] of ent) inv[v] = k;
  const url = "https://query1.finance.yahoo.com/v8/finance/spark?range=1d&interval=1d&symbols=" + encodeURIComponent(Object.values(map).join(","));
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(4000) }); if (!r.ok) return;
    const j = await r.json();
    for (const [ys, q] of Object.entries(j as Record<string, any>)) {
      const k = inv[ys]; if (!k) continue;
      if (k[0] === "_") { const m = k.slice(1); if (!dayOpen[m] && typeof q?.chartPreviousClose === "number") { prevClose[m] = q.chartPreviousClose; if (st[m]) st[m].pc = q.chartPreviousClose; } continue; }
      const p = q?.fulldayPrice ?? q?.close?.at(-1); const ts = q?.timestamp?.at(-1);
      if (typeof p === "number" && ts) put(k, p, ts * 1000, "yahoo", null, null, typeof q.chartPreviousClose === "number" ? q.chartPreviousClose : null);
    }
  } catch { /* next round */ }
}
async function metal(m: string) {
  try {
    const r = await fetch("https://api.gold-api.com/price/" + m, { headers: UA, signal: AbortSignal.timeout(3000) }); if (!r.ok) return;
    const j = await r.json(); if (typeof j.price === "number") put(m, j.price, j.updatedAt ? Date.parse(j.updatedAt) : Date.now(), "gold-api");
  } catch { /* next round */ }
}
// silver from the live Telegram feed (xag-live) when it is newer than gold-api
async function xagLive(admin: any) {
  try { const { data } = await admin.from("settings").select("value").eq("key", "xag_live").maybeSingle(); const v = data?.value as any;
    if (v?.price && v?.at) { const t = Date.parse(v.at); if (Date.now() - t < 120_000) put("XAG", Number(v.price), t, "tg"); } } catch { /* */ }
}
function tiingo(key: string, until: number) {
  let ws: WebSocket | null = null, tries = 0;
  const open = () => {
    if (Date.now() > until - 3000 || tries++ > 5) return;
    try { ws = new WebSocket("wss://api.tiingo.com/fx"); } catch { return; }
    ws.onopen = () => ws!.send(JSON.stringify({ eventName: "subscribe", authorization: key, eventData: { thresholdLevel: 5, tickers: TIINGO } }));
    ws.onmessage = (e) => { try { const m = JSON.parse(String(e.data)); if (m.messageType !== "A" || !Array.isArray(m.data) || m.data[0] !== "Q") return;
      const [, tk, date, , bid, mid, , ask] = m.data; const sym = ({ XAUUSD: "XAU", XAGUSD: "XAG" } as Record<string, string>)[String(tk).toUpperCase()] ?? String(tk).toUpperCase();
      if (typeof mid === "number") put(sym, mid, Date.parse(date) || Date.now(), "tiingo", bid ?? null, ask ?? null); } catch { /* */ } };
    ws.onclose = () => setTimeout(open, 1500);
    ws.onerror = () => { try { ws?.close(); } catch { /* */ } };
  };
  open();
  return () => { try { ws && (ws.onclose = null, ws.close()); } catch { /* */ } };
}
let bErr = false;
async function broadcast(payload: unknown) {
  try {
    const r = await fetch(URL_ + "/realtime/v1/api/broadcast", { method: "POST", headers: { apikey: SRK, Authorization: "Bearer " + SRK, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: "prices", event: "q", payload, private: true }] }), signal: AbortSignal.timeout(3000) });
    if (!r.ok && !bErr) { bErr = true; console.error("broadcast", r.status, (await r.text()).slice(0, 200)); }
  } catch (e) { if (!bErr) { bErr = true; console.error("broadcast", String(e)); } }
}
const pack = (keys: Iterable<string>) => { const q: Record<string, unknown[]> = {}; for (const k of keys) { const v = st[k]; if (v) q[k] = [v.p, v.b, v.a, v.t, v.pc, v.src]; } return q; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(id: string) {
  const admin = createClient(URL_, SRK, { auth: { persistSession: false } });
  const until = Date.now() + RUN_MS;
  const { data: cfg } = await admin.from("settings").select("key,value,updated_at").in("key", ["stream", "live_ticks", "stream_demand"]);
  const conf = (cfg?.find((r) => r.key === "stream")?.value || {}) as any;
  if (conf.enabled === false) return;
  const flush = Math.min(5000, Math.max(500, Number(conf.flush_ms) || 1000));
  // start from the last snapshot so "change since previous close" is known at once
  const snap = (cfg?.find((r) => r.key === "live_ticks")?.value as any)?.q || {};
  for (const [k, v] of Object.entries(snap as Record<string, any[]>)) { if (Array.isArray(v)) { st[k] = { p: v[0], b: v[1], a: v[2], t: v[3], pc: v[4], src: v[5] }; if (v[4] != null) prevClose[k] = v[4]; } }
  const { data: od } = await admin.from("settings").select("value").eq("key", "live_open").maybeSingle();
  if ((od?.value as any)?.d === tradingDay()) { dayKey = (od!.value as any).d; dayOpen = (od!.value as any).q || {}; for (const [m, v] of Object.entries(dayOpen)) { prevClose[m] = v; if (st[m]) st[m].pc = v; } }
  else if ((od?.value as any)?.d) { dayKey = (od!.value as any).d; }
  let demandAt = Date.parse((cfg?.find((r) => r.key === "stream_demand")?.updated_at as string) || "0");
  let stop = () => {};
  try { const { data: mk } = await admin.rpc("market_key"); if (mk) { const o = JSON.parse(mk); if (o.provider === "tiingo" && o.key) stop = tiingo(o.key, until); } } catch { /* */ }
  let tick = 0, lastFlush = 0, lastSnap = 0;
  while (Date.now() < until) {
    const t0 = Date.now(), watching = Date.now() - demandAt < 90_000;
    const jobs: Promise<unknown>[] = [];
    if (tick % 2 === 0) jobs.push(metal("XAU"), metal("XAG"));
    if (tick % 2 === 0) jobs.push(yahoo(YA));
    if (tick % 6 === 1) jobs.push(yahoo(YB));
    if (tick % 10 === 3) jobs.push(metal("XPT"), metal("XPD"), xagLive(admin));
    if (tick % 10 === 7) jobs.push(admin.from("settings").select("updated_at").eq("key", "stream_demand").maybeSingle().then(({ data }) => { if (data?.updated_at) demandAt = Date.parse(data.updated_at); }));
    await Promise.all(jobs);
    if (dirty.size && watching && Date.now() - lastFlush >= flush) {
      const keys = [...dirty]; dirty.clear(); lastFlush = Date.now();
      await broadcast({ s: Date.now(), q: pack(keys) });
    }
    if (dayKey && dayKey !== tradingDay() && st.XAU) {          // new trading day: today's open = yesterday's close for the metals
      dayKey = tradingDay(); dayOpen = {}; for (const m of METALS) if (st[m]) { dayOpen[m] = st[m].p; prevClose[m] = st[m].p; st[m].pc = st[m].p; dirty.add(m); }
      await admin.from("settings").upsert({ key: "live_open", value: { d: dayKey, q: dayOpen }, updated_at: new Date().toISOString() });
    } else if (!dayKey) { dayKey = tradingDay(); await admin.from("settings").upsert({ key: "live_open", value: { d: dayKey, q: {} }, updated_at: new Date().toISOString() }); }
    if (Date.now() - lastSnap > 5000) { lastSnap = Date.now();
      await admin.from("settings").upsert({ key: "live_ticks", value: { at: new Date().toISOString(), q: pack(Object.keys(st)) }, updated_at: new Date().toISOString() }); }
    tick++;
    await sleep(Math.max(150, 1000 - (Date.now() - t0)));
  }
  stop();
  await admin.from("settings").upsert({ key: "live_ticks", value: { at: new Date().toISOString(), q: pack(Object.keys(st)) }, updated_at: new Date().toISOString() });
  await admin.rpc("stream_lease", { p_id: id, p_ms: 0 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(URL_, SRK, { auth: { persistSession: false } });
  const w = await who(req, admin);
  if (!w.cron && !w.admin) return denied(cors);
  const id = crypto.randomUUID();
  const { data: ok } = await admin.rpc("stream_lease", { p_id: id, p_ms: RUN_MS + 2000 });
  if (!ok) return json({ ok: true, running: true });
  // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
  EdgeRuntime.waitUntil(run(id).catch((e) => console.error("stream", String(e))));
  return json({ ok: true, started: id });
});
