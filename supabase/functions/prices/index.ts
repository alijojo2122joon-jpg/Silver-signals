import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { who, denied } from "./gate.ts";

// Public market data: world gold/silver spot every 5s (silver = the live Telegram feed read every 5s by xag-live;
// gold-api is the fallback), 24h sparklines + DXY every 5 min, world markets (FX, crypto, oil) every 15s,
// USD/AFN market fallback every 6h. Only signed-in active members, the admin and the scheduled jobs may read it.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept": "application/json" };
// world markets shown in the ticker and usable as signal markets
const MKT: Record<string, string> = { eurusd: "EURUSD=X", gbpusd: "GBPUSD=X", usdjpy: "JPY=X", usdchf: "CHF=X", btcusd: "BTC-USD", ethusd: "ETH-USD", wti: "CL=F", brent: "BZ=F" };

async function spot(sym: string): Promise<{ price: number | null; at: string | null }> {
  try { const r = await fetch(`https://api.gold-api.com/price/${sym}`, { headers: UA, signal: AbortSignal.timeout(6000) }); if (!r.ok) return { price: null, at: null }; const j = await r.json();
    return { price: typeof j.price === "number" ? j.price : null, at: j.updatedAt || null }; } catch { return { price: null, at: null }; }
}
async function yahoo(sym: string, range = "2d", interval = "30m"): Promise<{ last: number | null; prev: number | null; spark: number[]; at: string | null }> {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res) continue;
      const ts: number[] = res.timestamp || []; const cl = res.indicators?.quote?.[0]?.close || [];
      const cut = Date.now() / 1000 - 86400;
      const closes: number[] = cl.filter((x: number | null, i: number) => typeof x === "number" && ts[i] >= cut);
      const t = res.meta?.regularMarketTime;
      return { last: res.meta?.regularMarketPrice ?? closes.at(-1) ?? null, prev: res.meta?.chartPreviousClose ?? res.meta?.previousClose ?? null, spark: closes, at: t ? new Date(t * 1000).toISOString() : null };
    } catch { /* try next */ }
  }
  return { last: null, prev: null, spark: [], at: null };
}
async function afnRate(): Promise<number | null> {
  try { const r = await fetch("https://open.er-api.com/v6/latest/USD"); if (!r.ok) return null; const j = await r.json(); const v = j?.rates?.AFN; return typeof v === "number" ? v : null; } catch { return null; }
}
// world metals market is closed from Friday 22:00 UTC to Sunday 22:00 UTC
const marketClosed = () => { const n = new Date(), d = n.getUTCDay(), h = n.getUTCHours(); return d === 6 || (d === 0 && h < 22) || (d === 5 && h >= 22); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const w = await who(req, admin);
  if (!w.cron && !w.admin && !w.member) return denied(cors);
  const { data: rows } = await admin.from("settings").select("key,value,updated_at").in("key", ["market_cache", "tg_cache", "xag_live", "ticker_cfg", "live_ticks"]);
  const liveV = rows?.find(r => r.key === "live_ticks")?.value as any;
  const withLive = (v: any) => (liveV?.q ? { ...v, live: liveV } : v);
  const cache = rows?.find(r => r.key === "market_cache"); const tg = rows?.find(r => r.key === "tg_cache")?.value as any;
  const live = rows?.find(r => r.key === "xag_live")?.value as any;
  if (cache && Date.now() - new Date(cache.updated_at).getTime() < 5_000) return json(withLive(cache.value));
  const prev = (cache?.value ?? {}) as Record<string, any>;
  const old = (k: string, ms: number) => !prev[k] || Date.now() - new Date(prev[k]).getTime() > ms;
  const needSpark = old("sparkAt", 300_000) || !prev.dxy?.price;
  const needAfn = old("afnAt", 6 * 3600_000) || !prev.afn?.rate;
  const needMkt = old("mktAt", 15_000) || !prev.markets;
  const none = { last: null, prev: null, spark: [] as number[], at: null };
  // admin-added Yahoo symbols (settings.ticker_cfg.extra, max 10)
  const extra = ((rows?.find(r => r.key === "ticker_cfg")?.value as any)?.extra || []).filter((x: any) => x?.key && /^[\^A-Za-z0-9=.\-]{1,20}$/.test(x?.y || "")).slice(0, 10);
  const SYM: Record<string, string> = { ...MKT }; for (const x of extra) SYM[x.key] = x.y;
  const mktKeys = Object.keys(SYM);
  const [xau, xag, gc, si, dxy, afn, ...mk] = await Promise.all([spot("XAU"), spot("XAG"),
    needSpark ? yahoo("GC=F") : none, needSpark ? yahoo("SI=F") : none, needSpark ? yahoo("DX-Y.NYB") : none, needAfn ? afnRate() : Promise.resolve(null),
    ...mktKeys.map(k => needMkt ? yahoo(SYM[k], "1d", "5m") : Promise.resolve(none))]);
  const pick = [live, tg?.xag].filter(Boolean).sort((a: any, b: any) => (b.id || 0) - (a.id || 0))[0] as any;
  const age = pick?.at ? Date.now() - new Date(pick.at).getTime() : Infinity;
  const tgx = pick && (age < 10 * 60_000 || (marketClosed() && age < 60 * 3600_000)) ? pick : null;
  const markets: Record<string, any> = {};
  mktKeys.forEach((k, i) => { const q = mk[i] as any, p = prev.markets?.[k];
    markets[k] = q.last != null ? { price: q.last, prev: q.prev ?? p?.prev ?? null, at: q.at ?? new Date().toISOString(), src: "yahoo", spark: q.spark?.length ? q.spark.slice(-48) : (p?.spark ?? []) } : (p ?? { price: null, prev: null, at: null, spark: [] }); });
  const val: Record<string, any> = {
    at: new Date().toISOString(), closed: marketClosed(),
    sparkAt: needSpark ? new Date().toISOString() : prev.sparkAt,
    afnAt: needAfn && afn ? new Date().toISOString() : prev.afnAt,
    mktAt: needMkt ? new Date().toISOString() : prev.mktAt,
    xau: { price: xau.price ?? gc.last ?? prev.xau?.price ?? null, quoteAt: xau.at, src: "gold-api", prev: gc.prev ?? prev.xau?.prev ?? null, spark: gc.spark.length ? gc.spark : (prev.xau?.spark ?? []) },
    xag: { price: tgx?.price ?? xag.price ?? si.last ?? prev.xag?.price ?? null, quoteAt: tgx?.at ?? xag.at, src: tgx ? "tg:NoghreLahzeyi" : "gold-api", prev: si.prev ?? prev.xag?.prev ?? null, spark: si.spark.length ? si.spark : (prev.xag?.spark ?? []) },
    dxy: { price: dxy.last ?? prev.dxy?.price ?? null, prev: dxy.prev ?? prev.dxy?.prev ?? null, spark: dxy.spark.length ? dxy.spark : (prev.dxy?.spark ?? []) },
    afn: { rate: afn ?? prev.afn?.rate ?? null, src: "market" },
    markets,
  };
  // the live relay's quote wins when it is newer (same source for the whole site)
  const lq = liveV?.q || {};
  for (const [k, K] of [["xau", "XAU"], ["xag", "XAG"], ["dxy", "DXY"]]) { const q = lq[K]; if (Array.isArray(q) && q[3] && q[3] > (Date.parse(val[k].quoteAt) || 0) && Date.now() - q[3] < 10 * 60_000) { val[k].price = q[0]; val[k].quoteAt = new Date(q[3]).toISOString(); } }
  for (const [k, K] of [["eurusd", "EURUSD"], ["gbpusd", "GBPUSD"], ["usdjpy", "USDJPY"], ["usdchf", "USDCHF"], ["wti", "WTI"], ["brent", "BRENT"]]) { const q = lq[K]; const m = markets[k];
    if (m && Array.isArray(q) && q[3] && q[3] > (Date.parse(m.at) || 0)) { m.price = q[0]; m.at = new Date(q[3]).toISOString(); } }
  for (const k of ["xau", "xag"]) { const s = val[k]; if (s.price && s.spark.length) s.spark = [...s.spark.slice(0, -1), s.price]; }
  await admin.from("settings").upsert({ key: "market_cache", value: val, updated_at: new Date().toISOString() });
  return json(withLive(val));
});
