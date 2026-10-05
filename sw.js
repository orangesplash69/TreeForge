/*!
 * TreeForge — service worker.
 * Network first, cache as fallback: online you always get the latest files,
 * offline the app still opens. Bump VERSION when the file list changes.
 */
const VERSION = "2.0.0";
const CACHE = `treeforge-${VERSION}`;
const ASSETS = [
  "./",
  "index.html",
  "css/app.css",
  "js/tree.js",
  "js/format.js",
  "js/parse.js",
  "js/share.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith("treeforge-") && key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) {
          return cached;
        }
        if (request.mode === "navigate") {
          return caches.match("./");
        }
        return Response.error();
      })
  );
});
