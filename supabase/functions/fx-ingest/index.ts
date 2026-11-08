import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Currency board ingester.
//  1. Reads public Telegram channels (t.me/s/<channel>, text posts only) that are listed as a source in public.currencies.
//  2. Stores every post in public.tg_messages (admin can review them).
//  3. Parses buy / sell (or a single reference number) per currency, validates it against the currency's range,
//     and inserts it into public.currency_rates only when it differs from the latest valid rate (history is never deleted).
//  4. Posts that look like rates but cannot be parsed are flagged status='review' for the admin.
//  Also refreshes a world reference table (open.er-api, USD base) once an hour into settings.fx_world.
// Called by pg_cron every 30 s.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const norm = (s: string) => s
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  .replace(/&rlm;|&lrm;|[‎‏‌‍]/g, "").replace(/ـ/g, "").replace(/ڪ/g, "ک").replace(/ك/g, "ک").replace(/[يۍې]/g, "ی").replace(/٫/g, ".")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/[*_]/g, "").replace(/[ \t]+/g, " ");

// "65.20" "280,80" (comma decimal) "262,800" (thousands) "0.28.00"/"3.78.30" (dotted groups → 0.2800 / 3.7830)
export function num(raw: string): number | null {
  let s = raw.trim().replace(/[.,]+$/, "");
  if (/^\d+\.\d+\.\d+$/.test(s)) { const [a, ...r] = s.split("."); s = a + "." + r.join(""); }
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const v = Number(s);
  return isFinite(v) && v > 0 ? v : null;
}

type Quote = { code: string; city: string; buy?: number | null; sell?: number | null; mid?: number | null };
// city names as written in the channel → city code
const CITIES: [RegExp, string][] = [
  [/کابل/, "kabul"], [/هرات/, "herat"], [/مزار/, "mazar"], [/کندهار|قندهار/, "kandahar"], [/جلال\s*آباد|ننگرهار|ننګرهار/, "jalalabad"],
  [/غزنی|غزنى/, "ghazni"], [/کندز|قندوز|کندوز/, "kunduz"], [/خوست/, "khost"]];
const cityOf = (t: string) => { for (const [re, c] of CITIES) if (re.test(t)) return c; return null; };
const HEADS: [RegExp, string][] = [
  [/دالر\s*به\s*افغانی[^\n|]{0,30}/g, "USD"],
  [/دالر\s*به\s*کلدار/g, "USD_PKR"],
  [/کلدار\s*به\s*افغانی/g, "PKR"],
  [/یورو\s*به\s*دالر/g, "EUR_USD"],
  [/یورو\s*به\s*افغانی/g, "EUR"],
  [/تومان\s*به\s*افغانی[^\n|]{0,15}بانکی/g, "IRR"],
  [/(?:تومان\s*)?چ\S?ک\s*به\s*افغانی/g, "IRR_CHK"],
];
const ANY_HEAD = /(دالر|یورو|تومان|چ\S?ک|کلدار)\s*به\s*(افغانی|دالر|کلدار)/g;
const N = "(\\d[\\d.,]*)";

export function parse(text: string): { quotes: Quote[]; review: boolean; reason?: string } {
  const quotes: Quote[] = [];
  let review = false, reason = "";
  const push = (q: Quote) => { if (!quotes.some(x => x.code === q.code && x.city === q.city)) quotes.push(q); };
  const firstLine = text.split("\n").find(l => l.trim()) || "";
  const msgCity = cityOf(firstLine);                       // e.g. "غزنی اخیری", "پایان ساعت کاری" (none)
  const starts = [...text.matchAll(ANY_HEAD)].map(m => m.index!);
  for (const [re, code] of HEADS) {
    for (const m of text.matchAll(re)) {
      const from = m.index! + m[0].length;
      const next = starts.find(p => p >= from) ?? text.length;
      const seg = text.slice(from, Math.min(next, from + 160));
      // city: written in the USD header ("دالر به افغانی … هرات"), else the message's city, else Kabul (Kabul market summary)
      const city = (code === "USD" ? cityOf(m[0]) : null) ?? msgCity ?? (code === "USD" ? null : "kabul");
      if (!city) { review = true; reason = code + ": city unknown"; continue; }
      const b = seg.match(new RegExp("خرید[^\\d\\n]{0,4}" + N)) || seg.match(new RegExp(N + "[^\\d\\n]{0,3}خرید"));
      const s = seg.match(new RegExp("فرو\\s?ش[^\\d\\n]{0,4}" + N));
      const buy = b ? num(b[1]) : null, sell = s ? num(s[1]) : null;
      if (buy == null && sell == null) { review = true; reason = code + ": no numbers"; continue; }
      push({ code, city, buy, sell });
    }
  }
  // provincial summary blocks: "غزنی اخیری / دالر کلدار 280.60 🔔 280.80 / دالر افغانی 65.21 🔔 65.23 / افغانی کلدار 4315 🔔 4317"
  if (msgCity) {
    const LINES: [RegExp, string][] = [[/دالر\s*کلدار/, "USD_PKR"], [/(?:دالر\s*افغانی|افغانی\s*دالر)/, "USD"], [/افغانی\s*کلدار/, "AFN_PKR"]];
    for (const line of text.split("\n")) {
      if (/خرید|فروش/.test(line)) continue;
      for (const [re, code] of LINES) {
        if (!re.test(line)) continue;
        const nums = [...line.matchAll(/\d[\d.,]*/g)].map(x => num(x[0])).filter((v): v is number => v != null);
        if (nums.length >= 2) push({ code, city: msgCity, buy: nums[0], sell: nums[1] });
        else if (nums.length === 1) { review = true; reason = code + ": one number"; }
        break;
      }
    }
  }
  // Gulf cross rates against the dollar (Kabul market), one number each
  if (/درهم|ریال|دینار/.test(text)) {
    for (const [flag, code] of [["🇸🇦", "SAR"], ["🇦🇪", "AED"], ["🇰🇼", "KWD"], ["🇶🇦", "QAR"], ["🇴🇲", "OMR"], ["🇧🇭", "BHD"]] as const) {
      const m = text.match(new RegExp(flag + "\\s*" + N));
      if (m) { const v = num(m[1]); if (v) push({ code, city: "kabul", mid: v }); }
    }
  }
  // Herat dollar→toman "262,800 معامله ⏳ فردایی"
  const h = text.match(new RegExp(N + "\\s*معامله[^\\n]{0,12}فردا"));
  if (h) { const v = num(h[1]); if (v) push({ code: "USD_IRR_HRT", city: "herat", mid: v }); }
  return { quotes, review, reason };
}

async function posts(ch: string) {
  const r = await fetch(`https://t.me/s/${ch}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketAnalysts/1.0)", "Accept-Language": "fa,en;q=0.8" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(ch + " " + r.status);
  const html = await r.text();
  return html.split('class="tgme_widget_message_wrap').slice(1).map(chunk => {
    const id = Number((chunk.match(/data-post="[^"\/]+\/(\d+)"/) || [])[1]);
    const at = (chunk.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || null;
    const tm = chunk.match(/js-message_text[^>]*>([\s\S]*?)<\/div>/);
    return { id, at, text: tm ? norm(tm[1]).trim() : "" };
  }).filter(p => p.id && p.text).sort((a, b) => a.id - b.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: curs } = await admin.from("currencies").select("id,code,source,auto,min_v,max_v");
  const byCode = new Map((curs || []).map((c: any) => [c.code, c]));
  const channels = [...new Set((curs || []).filter((c: any) => c.source?.startsWith("tg:")).map((c: any) => c.source.slice(3)))];
  const report: Record<string, unknown> = {};

  for (const ch of channels) {
    let ps: { id: number; at: string | null; text: string }[] = [];
    try { ps = await posts(ch); } catch (e) { report[ch] = "fetch failed: " + String(e).slice(0, 80); continue; }
    const { data: known } = await admin.from("tg_messages").select("msg_id,text,status").eq("channel", ch).in("msg_id", ps.map(p => p.id));
    const knownMap = new Map((known || []).map((k: any) => [Number(k.msg_id), k]));
    let inserted = 0, newMsgs = 0;
    for (const p of ps) {
      const k = knownMap.get(p.id);
      if (k && k.text === p.text) continue;          // already processed, not edited
      newMsgs++;
      const { quotes, review, reason } = parse(p.text);
      const accepted: Quote[] = [], rejected: string[] = [];
      for (const q of quotes) {
        const c: any = byCode.get(q.code);
        if (!c) continue;
        if (!c.source?.startsWith("tg:" + ch) || !c.auto) { rejected.push(q.code + ":manual/off"); continue; }
        const inRange = (v?: number | null) => v == null || ((c.min_v == null || v >= Number(c.min_v)) && (c.max_v == null || v <= Number(c.max_v)));
        const spreadOk = q.buy == null || q.sell == null || Math.abs(q.buy - q.sell) / Math.max(q.buy, q.sell) < 0.05;
        if (!inRange(q.buy) || !inRange(q.sell) || !inRange(q.mid) || !spreadOk) { rejected.push(q.code + ":out-of-range"); continue; }
        accepted.push(q);
        const postedAt = p.at ? new Date(p.at).toISOString() : new Date().toISOString();
        const { data: last } = await admin.from("currency_rates").select("buy,sell,mid,posted_at").eq("currency_id", c.id).eq("city", q.city).eq("valid", true)
          .order("posted_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
        if (last && new Date(last.posted_at) > new Date(postedAt)) continue;               // older than what we show
        const same = last && Number(last.buy ?? -1) === (q.buy ?? -1) && Number(last.sell ?? -1) === (q.sell ?? -1) && Number(last.mid ?? -1) === (q.mid ?? -1);
        if (same) continue;                                                                 // duplicate value
        const { error } = await admin.from("currency_rates").insert({ currency_id: c.id, city: q.city, buy: q.buy ?? null, sell: q.sell ?? null, mid: q.mid ?? null,
          kind: "auto", source: "tg:" + ch, msg_id: p.id, posted_at: postedAt });
        if (!error) inserted++;
      }
      const looksLikeRate = /خرید|فروش/.test(p.text) && /\d/.test(p.text);
      const status = accepted.length ? (rejected.some(r => r.endsWith("out-of-range")) || review ? "review" : "ok")
        : looksLikeRate || rejected.length ? "review" : "ignored";
      await admin.from("tg_messages").upsert({ channel: ch, msg_id: p.id, text: p.text.slice(0, 4000), posted_at: p.at,
        status, parsed: { quotes, rejected, reason: reason || undefined } });
    }
    report[ch] = { posts: ps.length, newOrEdited: newMsgs, inserted };
  }

  // world reference (hourly)
  const { data: w } = await admin.from("settings").select("updated_at").eq("key", "fx_world").maybeSingle();
  if (!w || Date.now() - new Date(w.updated_at).getTime() > 3600_000) {
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const j = await r.json(); if (j?.rates?.AFN) await admin.from("settings").upsert({ key: "fx_world", value: { at: new Date().toISOString(), src: "open.er-api.com", rates: j.rates }, updated_at: new Date().toISOString() }); }
    } catch { /* keep old */ }
  }
  return json({ at: new Date().toISOString(), report });
});
