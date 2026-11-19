// Service worker: permite instalar la web como app y abrirla sin conexión.
// - Páginas, código y datos: primero la red (siempre lo más nuevo); si no hay
//   internet, la última copia guardada.
// - Logos y fotos de jugadores: primero la copia guardada (cambian muy poco).
const VERSION = "v3";
const APP = `app-${VERSION}`, IMG = `img-${VERSION}`;
const SHELL = [
  "/", "/index.html", "/css/styles.css", "/manifest.webmanifest", "/icons/icon-192.png",
  "/js/app.js", "/js/config.js", "/js/teams.js", "/js/players.js", "/js/propchart.js",
  "/js/propview.js", "/js/parlay.js", "/js/parlayview.js", "/js/live.js", "/js/trackview.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![APP, IMG].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isImage = (url) => /(^|\.)cdn\.nba\.com$|(^|\.)espncdn\.com$/.test(url.hostname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (isImage(url)) {
    e.respondWith(
      caches.open(IMG).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok || res.type === "opaque") c.put(req, res.clone());
          return res;
        } catch { return Response.error(); }
      })
    );
    return;
  }

  const sameOrigin = url.origin === location.origin;
  const isData = url.hostname === "raw.githubusercontent.com";
  if (!sameOrigin && !isData) return; // fuentes, etc.: el navegador decide

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          // guardamos sin el "?v=…" para que la copia sin conexión sirva igual
          caches.open(APP).then((c) => c.put(sameOrigin ? url.pathname : req, copy));
        }
        return res;
      })
      .catch(async () => {
        const c = await caches.open(APP);
        return (await c.match(sameOrigin ? url.pathname : req)) ||
               (req.mode === "navigate" ? c.match("/index.html") : Response.error());
      })
  );
});
