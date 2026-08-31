# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Built and deployed. Live at https://pvp-shooter.sebi-50f.workers.dev (Cloudflare Workers,
account "Sebi"). Core loop works end to end: join a match, move via joystick, auto-fire
kills/deaths with level decay, shop purchases, PWA install. `docs/start-here.md`,
`docs/GAME_DESIGN.md`, and `docs/ARCHITECTURE.md` are the original design/build spec —
still accurate for game rules and intent, but written pre-implementation, so treat this
file as the source of truth for what actually exists and how to run it.

## Commands

```
npm run install:all        # installs both root and client/ deps
npm run build               # builds client/ into client/dist (tsc --noEmit + vite build)
npm run deploy               # builds client, then `wrangler deploy`
npm run dev:server            # wrangler dev (serves client/dist + the MatchRoom DO locally)
npm run dev:client             # vite dev server, client/ only (no live server backing it)
npx tsc --noEmit -p tsconfig.json      # type-check server/ + shared/
npx tsc --noEmit -p test/tsconfig.json # type-check test/
npx vitest run                          # server/ unit + integration tests
npx wrangler types                       # regenerate worker-configuration.d.ts after
                                           # changing wrangler.jsonc bindings
```

For local end-to-end testing, run `npm run dev:server` (this serves the already-built
`client/dist`, so run `npm run build` first after client changes) and connect via
`ws://localhost:8787/ws?match=<code>`, or open `http://localhost:8787/?match=<code>` in
a browser — the client resolves/generates the match code from the URL itself.

## What this is

A browser-based, PWA-installable 2D top-down PvP shooter for a small friend group.
Movement is via a single virtual joystick; weapons auto-fire at the nearest valid
target in range + line-of-sight — there is no manual aim. Skill instead comes from
dodging (projectiles have travel time/spread), breaking line-of-sight to drop enemy
target lock, reading weapon tells (windups/spin-ups), and dash timing.

## Architecture

- **Rendering**: Phaser 3 (`client/`), `phaser3-rex-plugins`' `VirtualJoyStick` for
  movement (imported directly, not through Phaser's plugin manager — see
  `client/src/input/TouchControls.ts`).
- **App shell**: a single Cloudflare Worker serving static assets (the built client
  bundle) plus the Durable Object — **not** Next.js, despite `docs/ARCHITECTURE.md`'s
  suggestion. There's no server-rendered content here (one canvas app + a realtime
  socket), so plain Vite + Workers Static Assets avoids the OpenNext/Next.js build
  pipeline for no benefit. See `wrangler.jsonc`.
- **Multiplayer**: one `MatchRoom` Durable Object per match code (`server/match-room.ts`,
  routed via `env.MATCH_ROOM.getByName(matchCode)` in `server/index.ts`), holding
  authoritative state and relaying it to both clients over WebSocket at
  `MATCH_RULES.matchTickMs` via a `setInterval` tick loop (not the Alarms API — too
  coarse at 100ms). Clients send only `input` (joystick vector, dash press); the DO
  resolves movement, LOS-gated auto-targeting, projectile/damage, money, leveling, and
  level decay. Match code is captured from the `?match=` query param on the DO's first
  `fetch()` and cached on the instance for the match's lifetime — never persisted, since
  the DO's lifetime *is* the match's.
- **PWA**: `pwa/public/manifest.json` (`orientation: landscape`), a precaching service
  worker (`pwa/public/sw.js` — network-first for navigation so a stale cached
  `index.html` never points at a previous deploy's now-deleted content-hashed JS/CSS;
  cache-first for everything else same-origin), and a rotate-prompt overlay driven by
  `matchMedia('(orientation: portrait)')` (iOS can't force orientation). These live
  under `pwa/public/` and land at the built bundle's root via `client/vite.config.ts`'s
  `publicDir` — `client/index.html` references them by absolute path
  (`/manifest.json`, `/sw.js`, etc.) with zero build-time coordination needed.

## The shared contracts

Three files under `shared/` are the frozen contracts every other module imports —
`client/`, `server/` never duplicate these numbers or shapes:
- `shared/game-config.ts` — weapon stats, leveling tiers, level-decay formula
  (`decayLevelOnDeath`: halves and **rounds down** on odd levels — picked as the
  friendlier option, an explicitly open decision in the original design doc), economy,
  match rules (default: first to 5 kills or a 5-minute timer).
- `shared/protocol.ts` — the full WebSocket message contract (`ClientToServerMessage` /
  `ServerToClientMessage`), including `PlayerState`/`ProjectileState`/etc.
- `shared/map.ts` — the single arena/obstacle/spawn/shop layout, used both for client
  rendering and server line-of-sight raycasting — they must render/raycast against
  identical obstacles for LOS-breaking to work correctly on both sides.

## Module layout

`client/` (Phaser game + touch UI + DOM HUD/shop/class overlays), `server/` (the
`MatchRoom` Durable Object + combat/geometry/rng helpers + Worker entry), `pwa/` (PWA
static assets, built into the client bundle's root). Built in parallel via git
worktrees per `docs/start-here.md`'s plan, then merged server → client → pwa. A known
gap this surfaced and required fixing post-merge: `GameScene` zooms its main camera out
to letterbox-fit the whole arena (no manual aim, so full-map visibility matters more
than a follow camera) — screen-fixed UI (joystick, dash button) needs its own separate,
unzoomed camera (`GameScene.uiCamera`), or `setScrollFactor(0)` alone still lets zoom
scale/shift it off the true screen corners. If you add more screen-fixed UI as Phaser
game objects (not DOM), route it through `uiCamera` the same way, ignoring it on
`cameras.main`.

## Weapon design (rock-paper-scissors, not a stat ladder)

Every class trades power for a specific, learnable, exploitable weakness — this is
core to the game, not incidental:

| Class | Strength | Exploitable weakness |
|---|---|---|
| Shooter (starter) | Balanced, no tell | Reference point; no weakness |
| Sniper | High single-hit damage, scales with distance | Long cooldown; visible charge tell — rush it during cooldown |
| Shotgun | Big burst damage at close range | Falls off a cliff past close range — kite it |
| Minigun | Sustained DPS, low execution skill | Slow tracking, spread widens while firing, movement penalty; visible spin-up — juke during spin-up or dodge diagonally |

All exact numbers live in `shared/game-config.ts` as tuning values (with comments
noting the reasoning where non-obvious) — expect to adjust them after playtesting with
the actual friend group, not treat them as final.

## Known gaps / not yet built

- **Friendly mode toggle** (mentioned in `docs/GAME_DESIGN.md`, normalizes everyone to
  level 1) has no wire message in `shared/protocol.ts` and isn't implemented — it's not
  in `docs/ARCHITECTURE.md`'s Definition of Done checklist, so it didn't block the v1
  build, but is a natural next feature.
- Client-side prediction/interpolation between `state` broadcasts isn't implemented —
  positions snap on each update rather than smoothly interpolating. Playable, not
  buttery.
- Full multiplayer tick-loop integration testing is light — `test/` covers LOS raycast
  correctness, damage/cooldown/falloff math, and the decay formula in isolation, plus
  one join→joined→state integration test. The rest was verified via manual two-client
  WebSocket smoke tests against both local `wrangler dev` and the live deployment
  (movement, LOS-gated combat, death/decay/respawn, shop purchases all confirmed
  working), not automated.
- `client/`'s `phaser3-rex-plugins` dependency pulls in a moderate-severity transitive
  advisory (`i18next-http-backend`, a path-traversal issue in an i18n HTTP loader we
  never use — only the virtual-joystick submodule is imported). Not exploitable in how
  it's used here; left as-is rather than forcing a breaking-change upgrade.
