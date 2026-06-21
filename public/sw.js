const CACHE = "caddie-v14";
const SHELL = ["/", "/index.html", "/config.js", "/manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // API always goes to network (your DB / OCR)
  // App shell: network-first, fall back to cache so it works offline.
  e.respondWith(
    fetch(e.request)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(m => m || caches.match("/index.html")))
  );
});
