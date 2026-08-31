import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * Runs tests inside the actual Workers runtime (workerd) via @cloudflare/vitest-plugin, per
 * instructions for this module — even the pure-function unit tests below benefit from running
 * in the same runtime as production (real crypto.getRandomValues, etc.) rather than Node's
 * polyfills. Points at the project's own wrangler.jsonc so bindings/compat date match.
 *
 * Note: @cloudflare/vitest-pool-workers (named in this module's task brief) is the historical
 * package name, but its latest published version (0.22.0) no longer exposes the documented
 * `defineWorkersConfig`/`"./config"` entry point and its bundled miniflare/wrangler versions
 * conflicted with this project's own wrangler install (see workerd version mismatch in
 * package.json's allowScripts history). @cloudflare/vitest-plugin is Cloudflare's current
 * package for the same job on Vitest 4.x — same underlying Workers-runtime test execution
 * (miniflare/workerd), exposed as a Vitest plugin instead of a custom pool.
 */
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
		}),
	],
});
