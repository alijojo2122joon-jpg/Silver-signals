import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Forex Factory weekly calendar (official JSON export), translated to Dari. Every fetch (max every 30 min) is also stored in
// public.econ_events, so past weeks accumulate and the apps can browse weeks and months; official central bank and statistics
// schedules for the coming year are stored there too and are hidden once Forex Factory lists the same release.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });

const EXACT: Record<string, string> = {
  "Non-Farm Employment Change": "آمار اشتغال غیرکشاورزی آمریکا (NFP)", "Unemployment Rate": "نرخ بیکاری", "Average Hourly Earnings m/m": "میانگین دستمزد ساعتی (ماهانه)",
  "CPI m/m": "تورم مصرف‌کننده CPI (ماهانه)", "CPI y/y": "تورم مصرف‌کننده CPI (سالانه)", "Core CPI m/m": "تورم هسته CPI (ماهانه)", "Core CPI y/y": "تورم هسته CPI (سالانه)",
  "PPI m/m": "تورم تولیدکننده PPI (ماهانه)", "Core PPI m/m": "تورم هسته تولیدکننده PPI (ماهانه)", "Core PCE Price Index m/m": "شاخص قیمت هسته PCE (ماهانه)", "PCE Price Index m/m": "شاخص قیمت PCE (ماهانه)",
  "Federal Funds Rate": "تصمیم نرخ بهره فدرال رزرو", "FOMC Statement": "بیانیه فدرال رزرو (FOMC)", "FOMC Press Conference": "نشست خبری فدرال رزرو", "FOMC Meeting Minutes": "صورت‌جلسه فدرال رزرو",
  "FOMC Economic Projections": "پیش‌بینی‌های اقتصادی فدرال رزرو", "Fed Chair Powell Speaks": "سخنرانی رئیس فدرال رزرو", "Unemployment Claims": "درخواست‌های بیمه بیکاری هفتگی",
  "Advance GDP q/q": "تولید ناخالص داخلی GDP (برآورد اولیه)", "Prelim GDP q/q": "تولید ناخالص داخلی GDP (برآورد دوم)", "Final GDP q/q": "تولید ناخالص داخلی GDP (نهایی)",
  "Retail Sales m/m": "خرده‌فروشی (ماهانه)", "Core Retail Sales m/m": "خرده‌فروشی هسته (ماهانه)", "ISM Manufacturing PMI": "شاخص مدیران خرید تولیدی ISM", "ISM Services PMI": "شاخص مدیران خرید خدمات ISM",
  "ISM Manufacturing Prices": "شاخص قیمت‌های تولیدی ISM", "Flash Manufacturing PMI": "شاخص مدیران خرید تولیدی (مقدماتی)", "Flash Services PMI": "شاخص مدیران خرید خدمات (مقدماتی)",
  "ADP Non-Farm Employment Change": "گزارش اشتغال ADP", "JOLTS Job Openings": "فرصت‌های شغلی JOLTS", "Prelim UoM Consumer Sentiment": "اعتماد مصرف‌کننده دانشگاه میشیگان (مقدماتی)",
  "Revised UoM Consumer Sentiment": "اعتماد مصرف‌کننده دانشگاه میشیگان (نهایی)", "Prelim UoM Inflation Expectations": "انتظارات تورمی دانشگاه میشیگان", "CB Consumer Confidence": "اعتماد مصرف‌کننده کنفرانس بورد",
  "Durable Goods Orders m/m": "سفارش کالاهای بادوام (ماهانه)", "Core Durable Goods Orders m/m": "سفارش کالاهای بادوام هسته (ماهانه)", "Empire State Manufacturing Index": "شاخص تولیدی نیویورک",
  "Philly Fed Manufacturing Index": "شاخص تولیدی فیلادلفیا", "New Home Sales": "فروش خانه‌های جدید", "Existing Home Sales": "فروش خانه‌های موجود", "Pending Home Sales m/m": "فروش خانه‌های در انتظار",
  "Building Permits": "مجوزهای ساختمانی", "Housing Starts": "شروع ساخت مسکن", "Industrial Production m/m": "تولید صنعتی (ماهانه)", "Trade Balance": "تراز تجاری", "Crude Oil Inventories": "ذخایر نفت خام آمریکا",
  "Natural Gas Storage": "ذخایر گاز طبیعی", "Treasury Currency Report": "گزارش ارزی خزانه‌داری آمریکا", "Bank Holiday": "تعطیلی بانکی", "Main Refinancing Rate": "تصمیم نرخ بهره بانک مرکزی اروپا",
  "Monetary Policy Statement": "بیانیه سیاست پولی", "ECB Press Conference": "نشست خبری بانک مرکزی اروپا", "ECB President Lagarde Speaks": "سخنرانی رئیس بانک مرکزی اروپا", "Official Bank Rate": "تصمیم نرخ بهره بانک انگلستان",
  "BOJ Policy Rate": "تصمیم نرخ بهره بانک ژاپن", "Cash Rate": "تصمیم نرخ بهره استرالیا", "Overnight Rate": "تصمیم نرخ بهره کانادا", "Official Cash Rate": "تصمیم نرخ بهره نیوزیلند", "SNB Policy Rate": "تصمیم نرخ بهره سوئیس",
  "Manufacturing PMI": "شاخص مدیران خرید تولیدی", "Non-Manufacturing PMI": "شاخص مدیران خرید غیرتولیدی", "Services PMI": "شاخص مدیران خرید خدمات", "Caixin Manufacturing PMI": "شاخص تولیدی چین (کایشین)", "Caixin Services PMI": "شاخص خدمات چین (کایشین)",
  "German Prelim CPI m/m": "تورم مقدماتی آلمان", "Daylight Saving Time Shift": "تغییر ساعت تابستانی", "GDP m/m": "تولید ناخالص داخلی GDP (ماهانه)", "Claimant Count Change": "تغییر متقاضیان بیمه بیکاری",
  "Employment Change": "تغییر اشتغال", "ZEW Economic Sentiment": "شاخص احساسات اقتصادی ZEW", "German ZEW Economic Sentiment": "شاخص احساسات اقتصادی ZEW آلمان", "Ifo Business Climate": "شاخص فضای کسب‌وکار Ifo",
};
const WORDS: [RegExp, string][] = [
  [/\bSpeaks\b/, "سخنرانی"], [/\bFOMC Member\b/, "عضو فدرال رزرو"], [/\bFed\b/, "فدرال رزرو"], [/\bCPI\b/, "تورم CPI"], [/\bGDP\b/, "تولید ناخالص GDP"],
  [/\bPMI\b/, "شاخص مدیران خرید"], [/\bm\/m\b/, "(ماهانه)"], [/\by\/y\b/, "(سالانه)"], [/\bq\/q\b/, "(فصلی)"],
  [/\bAuction\b/, "حراج اوراق"], [/\bTreasury\b/, "خزانه‌داری"], [/\bBond\b/, "اوراق"], [/\bRate\b/, "نرخ"], [/\bEmployment\b/, "اشتغال"],
  [/\bRetail Sales\b/, "خرده‌فروشی"], [/\bInflation\b/, "تورم"], [/\bSentiment\b/, "احساسات"], [/\bHoliday\b/, "تعطیلی"],
];
const CC: Record<string, string> = { USD: "آمریکا", EUR: "اروپا", GBP: "انگلستان", JPY: "ژاپن", CNY: "چین", CAD: "کانادا", AUD: "استرالیا", NZD: "نیوزیلند", CHF: "سوئیس" };
const CTRY: Record<string, string> = { USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CNY: "CN", CAD: "CA", AUD: "AU", NZD: "NZ", CHF: "CH" };
function fa(title: string): { t: string; exact: boolean } {
  if (EXACT[title]) return { t: EXACT[title], exact: true };
  for (const k of Object.keys(EXACT)) if (title.endsWith(" " + k)) return { t: EXACT[k], exact: true };
  let t = title; let hit = false;
  for (const [re, r] of WORDS) if (re.test(t)) { t = t.replace(re, r); hit = true; }
  return { t: hit ? t : title, exact: false };
}
const imp = (x: string) => x === "High" ? "high" : x === "Medium" ? "medium" : x === "Holiday" ? "holiday" : "low";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cache } = await admin.from("settings").select("value,updated_at").eq("key", "ff_cache").maybeSingle();
  if (cache && Date.now() - new Date(cache.updated_at).getTime() < 30 * 60_000) return json(cache.value);
  let raw: any[] = [];
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "Mozilla/5.0 MarketAnalysts" }, signal: AbortSignal.timeout(10000) });
    if (r.ok) raw = await r.json();
  } catch { /* use cache */ }
  if (!raw.length) return json(cache?.value ?? { at: null, events: [] });
  // keep every event of the week in the calendar table
  const rows = raw.filter(e => e?.title && e?.date).map(e => ({
    ext_key: `ff:${String(e.date).slice(0, 16)}:${e.country}:${e.title}`.slice(0, 200), at: e.date, currency: e.country, country: CTRY[e.country] || null,
    title: e.title, title_fa: fa(e.title).t, impact: imp(e.impact), forecast: e.forecast || null, previous: e.previous || null, actual: e.actual || null,
    source: "ff", source_url: e.url || "https://www.forexfactory.com/calendar", updated_at: new Date().toISOString(),
    all_day: /T00:00:00/.test(String(e.date)) && (e.impact === "Holiday" || /All Day|Tentative/i.test(String(e.time || ""))),
  }));
  for (let i = 0; i < rows.length; i += 200) await admin.from("econ_events").upsert(rows.slice(i, i + 200), { onConflict: "ext_key" });
  // an official schedule entry is replaced by Forex Factory's own listing of that release (same currency, within 90 minutes, high or medium impact)
  const highs = rows.filter(r => r.impact === "high" || r.impact === "medium");
  if (highs.length) {
    const from = new Date(Math.min(...highs.map(r => Date.parse(r.at))) - 90 * 60_000).toISOString(), to = new Date(Math.max(...highs.map(r => Date.parse(r.at))) + 90 * 60_000).toISOString();
    const { data: off } = await admin.from("econ_events").select("id,at,currency").eq("source", "official").eq("superseded", false).gte("at", from).lte("at", to);
    const ids = (off || []).filter(o => highs.some(h => h.currency === o.currency && Math.abs(Date.parse(h.at) - Date.parse(o.at)) <= 90 * 60_000)).map(o => o.id);
    if (ids.length) await admin.from("econ_events").update({ superseded: true }).in("id", ids);
  }
  const events = raw
    .filter(e => (e.impact === "High") || (e.impact === "Medium" && e.country === "USD") || (e.impact === "Holiday" && e.country === "USD"))
    .map(e => {
      const tr = fa(e.title);
      const assets = e.country === "USD" ? ["xau", "xag", "usd"] : e.country === "CNY" ? ["xau", "xag"] : ["xau"];
      return { title: e.title, title_fa: tr.t, tr: tr.exact, country: e.country, country_fa: CC[e.country] || e.country, at: e.date,
        impact: imp(e.impact) === "holiday" ? "low" : imp(e.impact), forecast: e.forecast || "", previous: e.previous || "", assets };
    });
  const val = { at: new Date().toISOString(), src: "Forex Factory", events };
  await admin.from("settings").upsert({ key: "ff_cache", value: val, updated_at: new Date().toISOString() });
  return json(val);
});
