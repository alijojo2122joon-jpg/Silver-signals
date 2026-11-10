/* Live market prices shared by the member app and the admin panel.
   - FX, metals, indices, energy: pushed by the server relay (edge function price-stream) over the private Realtime topic "prices"
   - crypto: straight from Binance's public WebSocket (bid/ask, every second)
   Each quote carries its source time, so the page shows how old the price really is and how long the transfer took. */

// [key, group, fa, ps, en, digits, icon]
export const LSYM = [
  ["XAU", "met", "طلا", "سره زر", "Gold", 2, "🥇"], ["XAG", "met", "نقره", "سپین زر", "Silver", 3, "🥈"],
  ["XPT", "met", "پلاتین", "پلاټین", "Platinum", 2, "⚪"], ["XPD", "met", "پالادیوم", "پلاډیوم", "Palladium", 2, "⚪"],
  ["DXY", "idx", "شاخص دالر", "د ډالر شاخص", "Dollar index", 3, "💵"], ["US500", "idx", "اس‌اندپی ۵۰۰", "S&P 500", "S&P 500", 2, "🇺🇸"],
  ["NAS100", "idx", "نزدک ۱۰۰", "نزدک ۱۰۰", "Nasdaq 100", 2, "🇺🇸"], ["US30", "idx", "داوجونز", "ډاو جونز", "Dow Jones", 2, "🇺🇸"], ["GER40", "idx", "دکس آلمان", "DAX", "DAX 40", 2, "🇩🇪"],
  ["EURUSD", "maj", "یورو / دالر", "یورو / ډالر", "Euro / Dollar", 4, "🇪🇺"], ["GBPUSD", "maj", "پوند / دالر", "پونډ / ډالر", "Pound / Dollar", 4, "🇬🇧"],
  ["USDJPY", "maj", "دالر / ین", "ډالر / ین", "Dollar / Yen", 3, "🇯🇵"], ["USDCHF", "maj", "دالر / فرانک", "ډالر / فرانک", "Dollar / Franc", 4, "🇨🇭"],
  ["AUDUSD", "maj", "دالر استرالیا / دالر", "استرالیايي ډالر / ډالر", "Aussie / Dollar", 4, "🇦🇺"], ["USDCAD", "maj", "دالر / دالر کانادا", "ډالر / کاناډايي ډالر", "Dollar / Loonie", 4, "🇨🇦"],
  ["NZDUSD", "maj", "دالر نیوزیلند / دالر", "نیوزیلنډي ډالر / ډالر", "Kiwi / Dollar", 4, "🇳🇿"],
  ["EURGBP", "min", "یورو / پوند", "یورو / پونډ", "Euro / Pound", 4, "🇪🇺"], ["EURJPY", "min", "یورو / ین", "یورو / ین", "Euro / Yen", 3, "🇪🇺"],
  ["GBPJPY", "min", "پوند / ین", "پونډ / ین", "Pound / Yen", 3, "🇬🇧"], ["EURCHF", "min", "یورو / فرانک", "یورو / فرانک", "Euro / Franc", 4, "🇪🇺"],
  ["EURAUD", "min", "یورو / دالر استرالیا", "یورو / استرالیايي ډالر", "Euro / Aussie", 4, "🇪🇺"], ["EURCAD", "min", "یورو / دالر کانادا", "یورو / کاناډايي ډالر", "Euro / Loonie", 4, "🇪🇺"],
  ["AUDJPY", "min", "دالر استرالیا / ین", "استرالیايي ډالر / ین", "Aussie / Yen", 3, "🇦🇺"], ["CADJPY", "min", "دالر کانادا / ین", "کاناډايي ډالر / ین", "Loonie / Yen", 3, "🇨🇦"],
  ["CHFJPY", "min", "فرانک / ین", "فرانک / ین", "Franc / Yen", 3, "🇨🇭"], ["NZDJPY", "min", "دالر نیوزیلند / ین", "نیوزیلنډي ډالر / ین", "Kiwi / Yen", 3, "🇳🇿"],
  ["GBPCHF", "min", "پوند / فرانک", "پونډ / فرانک", "Pound / Franc", 4, "🇬🇧"], ["GBPAUD", "min", "پوند / دالر استرالیا", "پونډ / استرالیايي ډالر", "Pound / Aussie", 4, "🇬🇧"],
  ["AUDCAD", "min", "دالر استرالیا / کانادا", "استرالیايي / کاناډايي", "Aussie / Loonie", 4, "🇦🇺"], ["AUDNZD", "min", "دالر استرالیا / نیوزیلند", "استرالیايي / نیوزیلنډي", "Aussie / Kiwi", 4, "🇦🇺"],
  ["USDTRY", "exo", "دالر / لیر ترکیه", "ډالر / ترکي لیره", "Dollar / Lira", 4, "🇹🇷"], ["USDCNH", "exo", "دالر / یوان", "ډالر / یوان", "Dollar / Yuan", 4, "🇨🇳"],
  ["USDINR", "exo", "دالر / روپیه هند", "ډالر / هندي روپۍ", "Dollar / Rupee", 3, "🇮🇳"], ["USDPKR", "exo", "دالر / کلدار", "ډالر / کلدار", "Dollar / PKR", 2, "🇵🇰"],
  ["USDAED", "exo", "دالر / درهم", "ډالر / درهم", "Dollar / Dirham", 4, "🇦🇪"],
  ["WTI", "cmd", "نفت WTI", "د WTI تېل", "WTI crude", 2, "🛢"], ["BRENT", "cmd", "نفت برنت", "د برنټ تېل", "Brent crude", 2, "🛢"],
  ["NGAS", "cmd", "گاز طبیعی", "طبیعي ګاز", "Natural gas", 3, "🔥"], ["COPPER", "cmd", "مس", "مس", "Copper", 4, "🟠"],
  ["BTCUSD", "cry", "بیت‌کوین", "بټکوین", "Bitcoin", 2, "₿"], ["ETHUSD", "cry", "اتریوم", "ایتریوم", "Ethereum", 2, "Ξ"],
];
export const LMETA = Object.fromEntries(LSYM.map(r => [r[0], { k: r[0], g: r[1], fa: r[2], ps: r[3], en: r[4], d: r[5], ic: r[6] }]));
export const LGROUPS = [["all", "همه", "ټول", "All"], ["met", "فلزات", "فلزات", "Metals"], ["maj", "جفت‌ارزهای اصلی", "اصلي جوړې", "Majors"], ["min", "جفت‌ارزهای فرعی", "فرعي جوړې", "Minors"],
  ["exo", "ارزهای منطقه", "سیمه‌ییز اسعار", "Regional"], ["idx", "شاخص‌ها", "شاخصونه", "Indices"], ["cmd", "انرژی و کالا", "انرژي او توکي", "Energy"], ["cry", "رمزارز", "کریپټو", "Crypto"]];
export const TICKER_DEFAULT = ["XAU", "XAG", "DXY", "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "EURJPY", "GBPJPY", "EURGBP", "BTCUSD", "ETHUSD", "WTI", "BRENT", "US500", "NAS100", "XPT"];
const FX = /^[A-Z]{6}$/;
export const lsName = (k, lang) => { const m = LMETA[k]; return m ? (m[lang] || m.fa) : k; };
export const lsCode = k => FX.test(k) && !/^(US500|NAS100|GER40|BTCUSD|ETHUSD)$/.test(k) ? k.slice(0, 3) + "/" + k.slice(3) : k === "XAU" || k === "XAG" || k === "XPT" || k === "XPD" ? k + "/USD" : k === "BTCUSD" ? "BTC/USD" : k === "ETHUSD" ? "ETH/USD" : k;
// one more decimal when the quote comes with a real bid/ask from a licensed or exchange feed
export const lsDigits = (k, q) => { const d = LMETA[k]?.d ?? 2; return q && (q.src === "tiingo") && LMETA[k]?.g !== "met" ? d + 1 : d; };
export const lsFmt = (k, v, q) => v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: lsDigits(k, q), maximumFractionDigits: lsDigits(k, q) });
export const lsPct = q => q && q.pc ? (q.p - q.pc) / q.pc * 100 : null;

export function startLive(sb, { onUpdate = () => {}, onStatus = () => {} } = {}) {
  const Q = {};
  let ch = null, rt = "connecting", bin = "connecting", ws = null, wsTry = 0, skew = 0, lastRx = 0, lastNet = null, stopped = false, pingT = null, bwT = null;
  const L = { Q, get status(){ return rt; }, get crypto(){ return bin; }, get lastRx(){ return lastRx; }, get net(){ return lastNet; }, get skew(){ return skew; } };
  const emit = keys => { try { onUpdate(keys); } catch (e) { console.error(e); } };
  const st = () => { try { onStatus(rt, bin); } catch {} };
  function apply(q, sentAt, viaSnap){
    const now = Date.now(), keys = [];
    for (const k in q) { const v = q[k]; if (!Array.isArray(v)) continue; const [p, b, a, t, pc, src] = v; const o = Q[k];
      if (o && t && o.t && t < o.t) continue;
      Q[k] = { p, b, a, t, pc: pc ?? o?.pc ?? null, src, rx: now, last: o?.p ?? null, dir: o && o.p !== p ? (p > o.p ? 1 : -1) : (o?.dir || 0) };
      keys.push(k); }
    if (!viaSnap && keys.length) { lastRx = now; if (sentAt) lastNet = Math.max(0, now - sentAt + skew); }
    if (keys.length) emit(keys);
  }
  L.seed = snap => { if (snap?.q) apply(snap.q, null, true); };
  // clock offset between this device and the server, so the delays shown are real (± half the round trip)
  (async () => { try { const t0 = Date.now(); const { data } = await sb.rpc("server_now"); const t1 = Date.now(); if (typeof data === "number") skew = data - (t0 + t1) / 2; } catch {} })();
  async function connect(){
    if (stopped) return;
    try { const { data } = await sb.auth.getSession(); if (data?.session?.access_token) sb.realtime.setAuth(data.session.access_token); } catch {}
    ch = sb.channel("prices", { config: { private: true } })
      .on("broadcast", { event: "q" }, m => { const pl = m?.payload; if (pl?.q) apply(pl.q, pl.s); })
      .subscribe(s => { rt = s === "SUBSCRIBED" ? "live" : s === "CLOSED" ? "off" : (s === "CHANNEL_ERROR" || s === "TIMED_OUT") ? "retry" : rt; st();
        if ((s === "CHANNEL_ERROR" || s === "TIMED_OUT") && !stopped) { const c = ch; ch = null; setTimeout(() => { try { sb.removeChannel(c); } catch {} connect(); }, 3000); } });
  }
  function binance(){
    if (stopped) return;
    const host = wsTry % 2 ? "wss://data-stream.binance.vision/stream" : "wss://stream.binance.com:9443/stream";
    try { ws = new WebSocket(host + "?streams=btcusdt@ticker/ethusdt@ticker"); } catch { bin = "off"; st(); return; }
    ws.onopen = () => { wsTry = 0; bin = "live"; st(); };
    ws.onmessage = e => { try { const d = JSON.parse(e.data)?.data; if (!d?.s) return; const k = d.s === "BTCUSDT" ? "BTCUSD" : d.s === "ETHUSDT" ? "ETHUSD" : null; if (!k) return;
      apply({ [k]: [Number(d.c), Number(d.b), Number(d.a), d.E, Number(d.x) || null, "binance"] }, null, true); lastRx = Date.now(); } catch {} };
    ws.onclose = () => { if (stopped) return; bin = "retry"; st(); clearTimeout(bwT); bwT = setTimeout(binance, Math.min(30000, 1500 * 2 ** wsTry++)); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  const ping = () => { if (!document.hidden) sb.rpc("live_ping").then(() => {}, () => {}); };
  connect(); binance(); ping(); pingT = setInterval(ping, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { ping(); if (!ws || ws.readyState > 1) { clearTimeout(bwT); binance(); } } });
  L.stop = () => { stopped = true; clearInterval(pingT); clearTimeout(bwT); try { ch && sb.removeChannel(ch); } catch {} try { ws && ws.close(); } catch {} };
  return L;
}

/* in-place painting: any element with data-lv="SYM" data-lf="p|b|a|sp|chg|pct|age|dot" */
export function paintLive(root, L, keys){
  if (!root || !L) return;
  const sel = keys ? keys.map(k => `[data-lv="${k}"]`).join(",") : "[data-lv]";
  if (!sel) return;
  root.querySelectorAll(sel).forEach(el => {
    const k = el.dataset.lv, q = L.Q[k]; if (!q) return; const f = el.dataset.lf || "p";
    if (f === "p" || f === "b" || f === "a") { const v = f === "p" ? q.p : q[f]; const t = lsFmt(k, v, q); if (el.textContent !== t) { el.textContent = t;
        if (f === "p" && q.last != null && keys) { el.classList.remove("lv-up", "lv-dn"); void el.offsetWidth; el.classList.add(q.dir > 0 ? "lv-up" : "lv-dn"); } } }
    else if (f === "sp") { el.textContent = q.b != null && q.a != null ? lsFmt(k, q.a - q.b, q) : "—"; }
    else if (f === "pct" || f === "chg") { const pc = lsPct(q); const row = el.closest("[data-lrow]") || el;
      if (pc == null) { el.textContent = "—"; } else { el.textContent = (f === "chg" ? (q.p - q.pc >= 0 ? "+" : "−") + lsFmt(k, Math.abs(q.p - q.pc), q) + " · " : "") + (pc > 0 ? "▲ " : pc < 0 ? "▼ " : "• ") + Math.abs(pc).toFixed(2) + "%"; }
      row.classList.toggle("lv-pos", pc > 0); row.classList.toggle("lv-neg", pc < 0); }
    else if (f === "age") { el.dataset.lt = q.t || ""; el.textContent = ageTxt(q.t, L.skew); }
  });
}
export const ageTxt = (t, skew = 0) => { if (!t) return "—"; const s = Math.max(0, Math.round((Date.now() + skew - t) / 1000)); return s < 60 ? s + "s" : s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; };
