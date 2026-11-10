import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { who, denied } from "./gate.ts";

// Reads the public Telegram channels listed in public.ext_channels (t.me/s/<handle>, public posts only) every minute.
//  - trading signals (symbol + buy/sell + entry + stop + targets) become auto-tracked signals with the channel shown as source
//  - news posts (channels with take_news) are kept for the news page with the channel as source
//  - posts about Iran's market (toman, rial, Tehran bourse…), ads, results and chit-chat are skipped
// Only fresh posts (< 30 min) whose entry is close to the live price become signals, so old or broken posts never fire.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const norm = (s: string) => s
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, ".")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[‎‏]/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

const IRAN = /تومان|تومن|ریال|بورس تهران|بورس ایران|فرابورس|شاخص کل|سکه امامی|سکه بهار|دلار آزاد|دلار تهران|بازار تهران|ایران|تهران|نیما|سنا |مثقال تهران|طلای ۱۸ عیار تهران|طلا داخلی|میلیون/;
const AD = /t\.me\/|@\w*bot\b|ثبت ?نام|عضو(ی|یت)|تخفیف|اشتراک|vip|پشتیبانی|لینک|کانال ما|تبلیغ|خرید اشتراک|deposit|واریز/i;
// news must be about markets / the economy (not chit-chat)
const ECON = /نفت|طلا|نقره|دلار|دالر|یورو|بیت ?کوین|کریپتو|ارز دیجیتال|فدرال|فدرال رزرو|نرخ بهره|تورم|بازار|اقتصاد|بورس|سهام|تحریم|جنگ|تعرفه|بانک مرکزی|اوپک|opec|fed|cpi|nfp|gold|oil|bitcoin|crypto|dollar|inflation|market|tariff/i;
const RESULT = /pip|پیپ|سود🔥|٪ ?سود|% ?سود|هدف(\s|‌)?ها زده|تاچ شد|استاپ خورد|tp kissed|کنسل|cancel|ریسک فری|risk ?free|break ?even/i;
const SYMS: [RegExp, string][] = [
  [/\bXAU ?\/? ?USD\b|\bGOLD\b|(^|\s|#)طلا/i, "xau"], [/\bXAG ?\/? ?USD\b|\bSILVER\b|(^|\s|#)نقره/i, "xag"],
  [/\bBTC\b|\bBTCUSDT?\b|بیت ?کوین/i, "btcusd"], [/\bETH\b|\bETHUSDT?\b|اتریوم/i, "ethusd"],
  [/\bEUR ?\/? ?USD\b/i, "eurusd"], [/\bGBP ?\/? ?USD\b/i, "gbpusd"], [/\bUSD ?\/? ?JPY\b/i, "usdjpy"], [/\bUSD ?\/? ?CHF\b/i, "usdchf"],
  [/\bUS ?OIL\b|\bWTI\b/i, "wti"], [/\bUK ?OIL\b|\bBRENT\b/i, "brent"]];
const PIP: Record<string, number> = { xau: 0.1, xag: 0.01, eurusd: 0.0001, gbpusd: 0.0001, usdchf: 0.0001, usdjpy: 0.01, btcusd: 1, ethusd: 0.1, wti: 0.01, brent: 0.01 };
const NUM = "(\\d+(?:[.,]\\d+)?)";
const num = (s?: string) => { if (!s) return null; const v = Number(s.replace(",", ".")); return isFinite(v) && v > 0 ? v : null; };

type Sig = { market: string; type: "buy" | "sell"; e1: number; e2: number | null; sl: number; tps: number[]; scalp: boolean };
function parseSignal(t: string): Sig | { skip: string } {
  const up = t.toUpperCase();
  let market = ""; for (const [re, m] of SYMS) if (re.test(t)) { market = m; break; }
  if (!market) return { skip: "no_symbol" };
  const buy = /\b(BUY|LONG)\b|خرید/.test(up), sell = /\b(SELL|SHORT)\b|فروش/.test(up);
  if (buy === sell) return { skip: "no_side" };
  const type = buy ? "buy" : "sell";
  const lines = t.split("\n");
  let e1: number | null = null, e2: number | null = null, sl: number | null = null; const tps: number[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    let m = l.match(new RegExp(`^(?:#\\s*)?(?:EN|ENTRY|ENTER|ورود|نقطه ورود|(?:BUY|SELL)(?: ?(?:NOW|LIMIT|STOP))?)\\s*[:：@-]?\\s*${NUM}(?:\\s*[-–~/]\\s*${NUM})?\\s*$`, "i"));
    if (m && e1 == null) { e1 = num(m[1]); e2 = num(m[2]); continue; }
    m = l.match(new RegExp(`^(?:SL|S\\.L|STOP(?: ?LOSS)?|استاپ|حد ?ضرر)\\s*[:：@-]?\\s*${NUM}\\s*(PIPS?|پیپ)?`, "i"));
    if (m && sl == null) { const v = num(m[1]); sl = v != null && m[2] ? -v : v; continue; }
    m = l.match(new RegExp(`^(?:TP|TARGET|FINAL|هدف|تارگت)(?:\\s*\\d{1,2})?(?:\\s*[:：@-]\\s*|\\s+)${NUM}`, "i"));
    if (m) { const v = num(m[1]); if (v != null) tps.push(v); }
  }
  if (e1 == null) return { skip: "no_entry" };
  if (sl != null && sl < 0) { const pips = -sl, ref = type === "buy" ? Math.min(e1, e2 ?? e1) : Math.max(e1, e2 ?? e1); sl = type === "buy" ? ref - pips * PIP[market] : ref + pips * PIP[market]; }
  if (sl == null) return { skip: "no_stop" };
  if (!tps.length) return { skip: "no_target" };
  const lo = Math.min(e1, e2 ?? e1), hi = Math.max(e1, e2 ?? e1);
  const ok = type === "buy" ? sl < lo && tps.every(x => x > hi) : sl > hi && tps.every(x => x < lo);
  if (!ok) return { skip: "levels_inconsistent" };
  const ord = [...new Set(tps)].sort((a, b) => type === "buy" ? a - b : b - a);
  return { market, type, e1, e2, sl, tps: ord.length > 3 ? [ord[0], ord[1], ord[ord.length - 1]] : ord, scalp: /SCALP|اسکالپ|اسکلپ/i.test(t) };
}

async function posts(handle: string) {
  const r = await fetch(`https://t.me/s/${encodeURIComponent(handle)}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketAnalysts/1.0)", "Accept-Language": "fa,en;q=0.8" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("http " + r.status);
  const html = await r.text();
  return html.split('class="tgme_widget_message_wrap').slice(1).map(chunk => {
    const id = Number((chunk.match(/data-post="[^"\/]+\/(\d+)"/) || [])[1]);
    const at = (chunk.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;
    const tm = chunk.match(/js-message_text[^>]*>([\s\S]*?)<\/div>/);
    const fwd = /tgme_widget_message_forwarded_from/.test(chunk);
    return { id, at, text: tm ? norm(tm[1]) : "", fwd };
  }).filter(p => p.id && p.text).sort((a, b) => a.id - b.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const w = await who(req, db);
  if (!w.cron && !w.admin) return denied(cors);
  const { data: chans } = await db.from("ext_channels").select("*").eq("enabled", true);
  const { data: mc } = await db.from("settings").select("value").eq("key", "market_cache").maybeSingle();
  const pv = (mc?.value ?? {}) as any;
  const live = (m: string): number | null => m === "xau" ? pv.xau?.price ?? null : m === "xag" ? pv.xag?.price ?? null : pv.markets?.[m]?.price ?? null;
  const report: Record<string, unknown> = {};
  for (const ch of chans || []) {
    const out = { posts: 0, signals: 0, news: 0, skipped: 0 } as Record<string, number>;
    try {
      const ps = await posts(ch.handle); out.posts = ps.length;
      const first = ch.last_msg_id == null;
      const fresh = ps.filter(p => ch.last_msg_id == null || p.id > Number(ch.last_msg_id));
      for (const p of fresh) {
        const age = p.at ? Date.now() - new Date(p.at).getTime() : Infinity;
        let kind = "ignored", reason = "", signalId: number | null = null;
        if (IRAN.test(p.text)) { kind = "skip"; reason = "iran"; }
        else if (ch.take_signals && /\b(TP|SL|EN|ENTRY|TARGET)\b|حد ?ضرر|تارگت|هدف/i.test(p.text) && !RESULT.test(p.text.split("\n").slice(0, 3).join(" "))) {
          const s = parseSignal(p.text);
          if ("skip" in s) { kind = "skip"; reason = s.skip; }
          else if (first || age > 30 * 60_000) { kind = "skip"; reason = "old"; }
          else {
            const L = live(s.market);
            const ref = s.e2 != null ? (s.e1 + s.e2) / 2 : s.e1;
            if (L == null) { kind = "skip"; reason = "no_live_price"; }
            else if (Math.abs(ref - L) / L > (s.market === "btcusd" || s.market === "ethusd" ? 0.05 : 0.015)) { kind = "skip"; reason = "far_from_price"; }
            else {
              const row = { market: s.market, type: s.type, entry_from: s.e1, entry_to: s.e2, sl: s.sl, tp1: s.tps[0] ?? null, tp2: s.tps[1] ?? null, tp3: s.tps[2] ?? null,
                timeframe: s.scalp ? "m15" : "h1", note: p.text.slice(0, 900), status: "active", phase: "waiting", auto: true,
                source: "tg:" + ch.handle, source_name: ch.name, source_url: `https://t.me/${ch.handle}/${p.id}`, ext_msg_id: p.id,
                created_at: p.at ?? new Date().toISOString() };
              const { data: ins, error } = await db.from("signals").insert(row).select("id").maybeSingle();
              if (error) { kind = "skip"; reason = "db: " + error.message.slice(0, 80); } else { kind = "signal"; signalId = ins?.id ?? null; out.signals++; }
            }
          }
        } else if (ch.take_news && !RESULT.test(p.text) && !AD.test(p.text) && !/https?:\/\//.test(p.text) && ECON.test(p.text) && p.text.replace(/\s/g, "").length >= 25 && age < 24 * 3600_000) { kind = "news"; out.news++; }
        else if (AD.test(p.text)) { kind = "skip"; reason = "ad"; }
        if (kind === "skip") out.skipped++;
        await db.from("ext_posts").upsert({ channel: ch.handle, msg_id: p.id, posted_at: p.at, text: p.text.slice(0, 2000), kind, reason: reason || null, signal_id: signalId });
      }
      const maxId = ps.length ? ps[ps.length - 1].id : ch.last_msg_id;
      await db.from("ext_channels").update({ last_msg_id: maxId, last_run: new Date().toISOString(), last_error: null }).eq("handle", ch.handle);
    } catch (e) {
      await db.from("ext_channels").update({ last_run: new Date().toISOString(), last_error: String(e).slice(0, 200) }).eq("handle", ch.handle);
      out.error = 1;
    }
    report[ch.handle] = out;
  }
  await db.from("ext_posts").delete().lt("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).neq("kind", "signal");
  return json({ ok: true, report });
});
