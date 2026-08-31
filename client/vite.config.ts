import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * publicDir points at pwa/public so the pwa module's manifest, service worker, icons, and
 * rotate-overlay assets land at the root of the built bundle without client/ needing to
 * import or coordinate with pwa/ at all — just reference them by absolute path (e.g.
 * `/manifest.json`, `/sw.js`) in index.html.
 */
export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	publicDir: fileURLToPath(new URL("../pwa/public", import.meta.url)),
	server: {
		fs: {
			allow: [".."],
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
