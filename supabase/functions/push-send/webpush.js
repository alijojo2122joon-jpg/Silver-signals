// Minimal Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID) using only WebCrypto.
const te = new TextEncoder();
export const b64u = (b) => { let s = ""; const a = new Uint8Array(b); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const ub64 = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const cat = (...xs) => { const n = xs.reduce((a, x) => a + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const C = globalThis.crypto.subtle;
async function hkdf(salt, ikm, info, bits) { const k = await C.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await C.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bits)); }

export async function vapidHeader(endpoint, pubB64, privB64, subject) {
  const pub = ub64(pubB64), aud = new URL(endpoint).origin;
  const key = await C.importKey("jwk", { kty: "EC", crv: "P-256", d: privB64, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const h = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" }))), p = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await C.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${pubB64}`;
}

export async function encrypt(payload, p256dhB64, authB64) {
  const ua = ub64(p256dhB64), auth = ub64(authB64);
  const as = await C.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await C.exportKey("raw", as.publicKey));
  const uaKey = await C.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await C.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode("WebPush: info\0"), ua, asPub), 256);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 96);
  const k = await C.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await C.encrypt({ name: "AES-GCM", iv: nonce }, k, cat(te.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), asPub, ct);
}

export async function sendPush(sub, payload, vapid) {
  const body = await encrypt(payload, sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, { method: "POST", headers: { "Authorization": await vapidHeader(sub.endpoint, vapid.pub, vapid.priv, vapid.subject), "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high" }, body });
  return r.status;
}
