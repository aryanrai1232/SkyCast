/* SkyCast service worker: makes the app installable and lets it open offline. */
const SHELL_CACHE = "skycast-shell-v1";
const ICON_CACHE = "skycast-icons-v1";
const SHELL = [
  "/", "/static/style.css", "/static/app.js", "/static/theme.js",
  "/manifest.webmanifest", "/static/icons/icon-192.png", "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== SHELL_CACHE && k !== ICON_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // weather data is always live from the network (the page keeps its own saved copy)
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  if (url.origin === self.location.origin) {
    // network first so updates arrive immediately; cache is the offline fallback
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) =>
          hit || (req.mode === "navigate" ? caches.match("/") : Response.error())))
    );
    return;
  }

  // weather icons: cache first
  if (url.hostname === "openweathermap.org" && url.pathname.startsWith("/img/")) {
    event.respondWith(
      caches.open(ICON_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res.ok || res.type === "opaque") cache.put(req, res.clone());
          return res;
        })))
    );
  }
});
