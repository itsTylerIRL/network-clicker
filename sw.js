/* the network is growing: the offline part. The page, its code and the icons are kept when this installs; every
   picture is kept the first time it's used (or all at once, from settings). The page itself and version.json are
   asked for fresh every time and only come from here with no connection. build.py stamps V, so a new version of
   the game is a new version of this file, and the browser installs it on the next visit. */
const V = "37e0f3c935";
const CORE = "network-core-" + V, PICS = "network-assets";
const SHELL = ["./", "index.html", "manifest.webmanifest", "css/style.css?v=" + V, "js/data.js?v=" + V, "js/fx.js?v=" + V, "js/game.js?v=" + V, "js/ambient.js?v=" + V, "js/music.js?v=" + V,
  "assets/asset_index.json", "assets/img/cult_coin.png?v=2", "assets/img/cancel.png",
  "assets/icons/favicon-32.png", "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/icon-maskable.png", "assets/icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CORE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("network-core-") && k !== CORE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const fresh = path => path.endsWith("/") || path.endsWith("/index.html") || path.endsWith("/version.json") || path.endsWith(".webmanifest");
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate" || fresh(url.pathname)) {
    // the network first, so a new version shows up; what's kept if there's no connection
    e.respondWith(fetch(req).then(r => {
      if (r.ok && !url.pathname.endsWith("/version.json")) { const copy = r.clone(); caches.open(CORE).then(c => c.put(req.mode === "navigate" ? "./" : req, copy)); }
      return r;
    }).catch(() => caches.match(req.mode === "navigate" ? "./" : req, { ignoreSearch: true })
      .then(r => r || (req.mode === "navigate" ? caches.match("./") : Response.error()))));
    return;
  }
  // everything else never changes at a given address (code carries ?v=), so what's kept is used first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(url.pathname.includes("/assets/") ? PICS : CORE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }))));
});

// a notification tapped: back to the game
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./");
  }));
});
