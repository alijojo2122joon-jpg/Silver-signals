import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Economic news for Afghan money changers, several sources, everything shown in Persian (Dari).
//  - afaaq.af economic RSS (Dari)            → daily gold/fx reports + economy news
//  - ariananews.af Dari RSS, economy keywords only
//  - Google News (English) for Da Afghanistan Bank, Ministry of Finance, World Bank, world gold market
//    → titles machine-translated to Persian once and cached by link.
// Cached 3 minutes in settings.news_cache. Also expires local-rates cache when a newer afaaq rate report appears.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const ent = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const dec = (s: string) => ent(ent(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? dec(m[1]) : ""; };
const isoOf = (s: string) => { const d = new Date(s); return isNaN(+d) ? new Date().toISOString() : d.toISOString(); };

type Item = { title: string; title_en?: string; link: string; at: string; kind: string; org: string; src: string; desc?: string; tr?: boolean };

async function rss(url: string, n = 30) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(url + " " + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n).map(m => m[1]);
}

async function afaaq(): Promise<Item[]> {
  return (await rss("https://afaaq.af/economic-fa/feed/", 25)).map(x => {
    const link = tag(x, "link");
    const kind = /-tala\/?$/.test(link) ? "gold" : /-afghani\/?$/.test(link) ? "fx" : "news";
    return { title: tag(x, "title"), link, at: isoOf(tag(x, "pubDate")), kind, org: "afaaq", src: "آفاق", desc: tag(x, "description").replace(/The post .*$/, "").slice(0, 260) };
  }).filter(i => i.title && i.link);
}

const ECON_W = ["اقتصاد", "اقتصادی", "بانک", "بانک‌ها", "مالیه", "مالیات", "مالیاتی", "دالر", "افغانی", "اسعار", "ارز", "طلا", "نقره", "تجارت", "تجارتی", "تجارت‌", "صادرات", "واردات", "گمرک", "گمرکات", "بودجه", "سرمایه‌گذاری", "سرمایه", "بازار", "قیمت", "قیمت‌ها", "نرخ", "تورم", "معادن", "ترانزیت", "بندر", "سرای", "صرافان", "صرافی", "پول", "پولی", "بانک‌جهانی", "صادراتی", "وارداتی", "کالا", "کالاها", "تعرفه", "قرضه", "اقتصادی‌"];
const ECON_SET = new Set(ECON_W);
const isEcon = (t: string) => t.split(/[\s،:؛«»"'()\-–|.!?؟]+/).some(w => ECON_SET.has(w) || ECON_SET.has(w.replace(/(‌ها|ها|ی|‌ی)$/, ""))) || /بانک جهانی|صندوق بین‌المللی پول|اتاق تجارت|سرای شهزاده/.test(t);
async function ariana(): Promise<Item[]> {
  return (await rss("https://ariananews.af/fa/feed/", 40)).map(x => ({ title: tag(x, "title"), link: tag(x, "link"), at: isoOf(tag(x, "pubDate")), kind: "news", org: "ariana", src: "آریانا نیوز",
    desc: tag(x, "description").replace(/The post .*$/, "").replace(/\[…\]|\[&hellip;\]/g, "").slice(0, 260) }))
    .filter(i => i.title && i.link && isEcon(i.title));
}

// Google News (English) → translated
const GN = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const AFG = /afghan|kabul|taliban|islamic emirate/i;
const GQ: { org: string; src: string; kind: string; q: string; must?: RegExp; max: number }[] = [
  { org: "dab", src: "بانک مرکزی (د افغانستان بانک)", kind: "news", q: '("Da Afghanistan Bank" OR "Afghanistan central bank" OR "Afghan central bank" OR "DAB auction" OR afghani currency) when:7d', must: AFG, max: 6 },
  { org: "mof", src: "وزارت مالیه", kind: "news", q: 'Afghanistan ("Ministry of Finance" OR "finance ministry" OR budget OR customs revenue) when:7d', must: AFG, max: 5 },
  { org: "wb", src: "بانک جهانی", kind: "news", q: '"World Bank" (Afghanistan OR "South Asia" OR "commodity prices" OR "Commodity Markets Outlook") when:30d', max: 5 },
  { org: "gold", src: "بازار جهانی طلا", kind: "news", q: '(gold price OR silver price OR "Federal Reserve" rates) (Reuters OR Kitco OR Bloomberg) when:1d', max: 5 },
];
const gErr: string[] = [];
// Google blocks this server's IP (503), so the database fetches these feeds every 3 min (pg_net → public.news_feeds).
async function gnews(admin: any): Promise<Item[]> {
  const out: Item[] = []; gErr.length = 0;
  const { data: feeds } = await admin.from("news_feeds").select("org,xml,fetched_at");
  const stored = new Map<string, string>((feeds || []).filter((f: any) => f.xml).map((f: any) => [f.org, f.xml]));
  await Promise.all(GQ.map(async g => {
    try {
      const xml = stored.get(g.org);
      const blocks = xml ? [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(m => m[1]) : await rss(GN(g.q), 25);
      const rows = blocks.map(x => {
        const raw = tag(x, "title"), srcName = tag(x, "source");
        const title = srcName && raw.endsWith(" - " + srcName) ? raw.slice(0, -(srcName.length + 3)) : raw.replace(/ - [^-]{2,40}$/, "");
        return { title_en: title, publisher: srcName, link: tag(x, "link"), at: isoOf(tag(x, "pubDate")) };
      }).filter(r => r.title_en && r.link && (!g.must || g.must.test(r.title_en)));
      rows.sort((a, b) => b.at.localeCompare(a.at));
      for (const r of rows.slice(0, g.max)) out.push({ title: r.title_en, title_en: r.title_en, link: r.link, at: r.at, kind: g.kind, org: g.org, src: g.src + (r.publisher ? " · " + r.publisher : "") });
      gErr.push(g.org + ":" + rows.length);
    } catch (e) { gErr.push(g.org + " ERR " + String(e).slice(0, 90)); }
  }));
  return out;
}

async function toFa(text: string): Promise<string> {
  const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fa&dt=t&q=" + encodeURIComponent(text);
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("tr " + r.status);
  const j = await r.json();
  return (j[0] || []).map((x: unknown[]) => x[0]).join("").trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cache } = await admin.from("settings").select("value,updated_at").eq("key", "news_cache").maybeSingle();
  const force = new URL(req.url).searchParams.has("force");
  if (!force && cache && cache.value?.v === 2 && Date.now() - new Date(cache.updated_at).getTime() < 3 * 60_000) return json(cache.value);

  const res = await Promise.allSettled([afaaq(), ariana(), gnews(admin)]);
  let items: Item[] = res.flatMap(r => r.status === "fulfilled" ? r.value : []);
  const errs = res.map((r, i) => r.status === "rejected" ? ["afaaq", "ariana", "gnews"][i] + ": " + String(r.reason).slice(0, 80) : null).filter(Boolean);
  if (!items.length) return json(cache?.value ?? { at: null, items: [] });

  // translate English titles once (reuse previous translations by link/title)
  const prev = new Map<string, string>();
  for (const i of (cache?.value?.items || []) as Item[]) if (i.tr && i.title_en) { prev.set(i.link, i.title); prev.set(i.title_en, i.title); }
  let budget = 24;
  await Promise.all(items.filter(i => i.title_en).map(async i => {
    const p = prev.get(i.link) || prev.get(i.title_en!);
    if (p) { i.title = p; i.tr = true; return; }
    if (budget-- <= 0) { i.tr = false; return; }
    try { i.title = await toFa(i.title_en!); i.tr = true; } catch { i.tr = false; }
  }));
  items = items.filter(i => !i.title_en || i.tr); // never show untranslated English in the Persian list

  // dedupe (same story from several queries/sources) and sort newest first
  const seen = new Set<string>();
  items = items.sort((a, b) => b.at.localeCompare(a.at)).filter(i => { const k = norm(i.title_en || i.title); if (seen.has(k) || seen.has(i.link)) return false; seen.add(k); seen.add(i.link); return true; }).slice(0, 60);

  const newestRate = items.filter(i => i.org === "afaaq" && i.kind !== "news").map(i => i.at).sort().at(-1);
  if (newestRate) {
    const { data: lc } = await admin.from("settings").select("updated_at").eq("key", "local_cache").maybeSingle();
    if (lc && new Date(lc.updated_at) < new Date(newestRate)) await admin.from("settings").update({ updated_at: "2000-01-01T00:00:00Z" }).eq("key", "local_cache");
  }
  const val = { v: 2, at: new Date().toISOString(), src: "multi", errs, gnews: gErr, items };
  await admin.from("settings").upsert({ key: "news_cache", value: val, updated_at: new Date().toISOString() });
  return json(val);
});
