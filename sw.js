// Network-first service worker: always fresh when online, last copy when offline.
const C = "ma-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin || r.url.includes("version.json")) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true })));
});

// Web Push: show notifications even when the site is closed.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Market Analysts", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Market Analysts", { body: d.body || "", tag: d.tag, renotify: true, dir: "rtl", lang: "fa",
    icon: "img/app/icon-192.png", badge: "img/app/icon-192.png", vibrate: [120, 60, 120], data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope) && "navigate" in c) return c.navigate(url).then(w => (w || c).focus());
    return self.clients.openWindow(url);
  }));
});
