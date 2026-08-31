/**
 * App-shell service worker. Caches the static bundle (HTML/JS/CSS/manifest/icons)
 * only — multiplayer WebSocket traffic (/ws) and any cross-origin request are never
 * cached or intercepted.
 *
 * Strategy:
 *  - install: precache the known, un-hashed app-shell files (this list) so the very
 *    first load after "Add to Home Screen" already has a usable offline shell, even
 *    before the browser has made a second request for anything.
 *  - navigation requests (the HTML document): network-first, falling back to the
 *    cached shell when offline. This matters because client/'s build emits
 *    content-hashed JS/CSS filenames per deploy — a cache-first index.html would
 *    keep pointing at a previous deploy's now-deleted hashed assets and break the
 *    app until the cache was manually cleared.
 *  - everything else same-origin (hashed JS/CSS bundle chunks, sprites, etc.):
 *    cache-first, populating the cache lazily on first fetch. Safe to cache
 *    aggressively since a new deploy ships new filenames rather than mutating
 *    these in place.
 *
 * Bump CACHE_NAME whenever this file or the precache list changes, so `activate`'s
 * cleanup evicts the old versioned cache instead of leaving it orphaned.
 */
const CACHE_NAME = "pvp-shooter-shell-v2";

// Known, stable (non-content-hashed) filenames the pwa module owns, plus the app
// shell document itself. Does NOT include the client bundle's hashed JS/CSS output
// (client/dist/assets/*) since those filenames aren't known here — they're picked
// up lazily by the fetch handler below on first request instead.
const PRECACHE_URLS = [
	"/",
	"/manifest.json",
	"/register-sw.js",
	"/rotate-overlay.css",
	"/rotate-overlay.js",
	"/icons/icon-192.png",
	"/icons/icon-512.png",
	"/icons/icon-192-maskable.png",
	"/icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) =>
			// Precache best-effort: don't fail install (and thus block activation) if
			// one URL 404s in a given environment — the fetch handler will pick up
			// anything missed on first real request anyway.
			Promise.all(
				PRECACHE_URLS.map((url) =>
					cache.add(url).catch((err) => console.warn(`sw: precache failed for ${url}`, err)),
				),
			),
		),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
	);
	self.clients.claim();
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (url.pathname === "/ws" || url.origin !== self.location.origin) return;
	if (request.method !== "GET") return;

	const isNavigation = request.mode === "navigate" || request.destination === "document";

	if (isNavigation) {
		event.respondWith(
			fetch(request)
				.then((response) => {
					if (response.ok) {
						caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
					}
					return response;
				})
				.catch(async () => {
					const cache = await caches.open(CACHE_NAME);
					return (await cache.match(request)) ?? (await cache.match("/"));
				}),
		);
		return;
	}

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			const cached = await cache.match(request);
			if (cached) return cached;
			const response = await fetch(request);
			if (response.ok) cache.put(request, response.clone());
			return response;
		}),
	);
});
