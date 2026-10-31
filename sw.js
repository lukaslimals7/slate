/* Slate service worker — the app shell cached so it opens offline and installs.
   Bump VERSION when shipping an update: old caches are dropped on activate. */
const VERSION = "slate-v1";
const SHELL = VERSION + "-shell";
const RUNTIME = VERSION + "-runtime";
const CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* one missing file must not abort the whole install */
    await Promise.all(CORE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function put(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return;
  try { (await caches.open(cacheName)).put(request, response.clone()); } catch (_) {}
}

async function networkFirst(request, cacheName) {
  try {
    const fresh = await fetch(request);
    put(cacheName, request, fresh);
    /* the shell is stored under its bare path so offline navigations find it
       whatever query string the start_url carried */
    if (request.mode === "navigate") put(cacheName, "./index.html", fresh);
    return fresh;
  } catch (_) {
    const cache = await caches.open(cacheName);
    return (await cache.match("./index.html")) ||
           (await cache.match("./")) ||
           new Response("<h1>Slate is offline</h1><p>Open it once online to cache the app.</p>",
                        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request).then((res) => { put(cacheName, request, res); return res; }).catch(() => null);
  return cached || (await network) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL));
    return;
  }
  /* fonts are the only third-party request the app makes */
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
  }
});
