/**
 * App-shell service worker. Caches the static bundle (JS/CSS/manifest/icons) only —
 * multiplayer WebSocket traffic (/ws) and any future API calls are never cached.
 * TODO(pwa): tune the precache list / versioning strategy once client/dist asset
 * filenames stabilize; this baseline is safe (network-first for navigation, cache-first
 * for same-origin static assets) but not yet optimized for offline app-shell boot.
 */
const CACHE_NAME = "pvp-shooter-shell-v1";

self.addEventListener("install", (event) => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
	);
	self.clients.claim();
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.pathname === "/ws" || url.origin !== self.location.origin) return;
	if (event.request.method !== "GET") return;

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			const cached = await cache.match(event.request);
			if (cached) return cached;
			const response = await fetch(event.request);
			if (response.ok) cache.put(event.request, response.clone());
			return response;
		}),
	);
});
