# Start here (Claude Code)

You're building a browser-based, PWA-installable 2D top-down PvP shooter for a small
friend group. Full design spec is in `docs/GAME_DESIGN.md`, tech decisions are in
`docs/ARCHITECTURE.md`. Read both fully before writing any code.

Goal for this session: a **ready-to-play** build, per the Definition of Done at the
bottom of `docs/ARCHITECTURE.md` — deployed, joinable by two players on phones,
core loop working end to end. Not a prototype of one system; a playable match.

## Step 1 — scaffold before parallelizing
Do this yourself, serially, before spinning up any subagents:
1. Init the Next.js app + Cloudflare Workers config.
2. Create `/shared/game-config.ts` from the weapon table and leveling/decay rules in
   `docs/GAME_DESIGN.md`. This file is the shared contract every other module depends
   on — get it right first, since worktrees below will import it.
3. Commit this scaffold to `main` before creating any worktrees, so every worktree
   branches from a working base that already has the shared config.

## Step 2 — set up git worktrees per module
Create one worktree per module from `docs/ARCHITECTURE.md`'s module boundaries, so
subagents can work in parallel without touching each other's files:

```
git worktree add ../game-client   -b feature/game-client
git worktree add ../game-server   -b feature/game-server
git worktree add ../game-pwa      -b feature/pwa-shell
```

(`shared/` is already done in Step 1 and lives on `main` — don't give it its own
worktree, just make sure each new worktree branches from the commit that includes it.)

## Step 3 — delegate to subagents
Launch one subagent per worktree, each scoped to only its module:
- **client agent** (`../game-client`): Phaser scene, virtual joystick input, dash
  button, HUD, shop UI, WebSocket client connecting to the Durable Object. Reads
  weapon stats from `shared/game-config.ts`, never hardcodes numbers.
- **server agent** (`../game-server`): Durable Object — authoritative tick, target
  acquisition + line-of-sight checks, projectile/damage resolution, money and
  leveling, the level-decay-on-death formula. Also reads from `shared/game-config.ts`.
- **pwa agent** (`../game-pwa`): manifest.json, service worker, app icons, the
  `matchMedia('(orientation: portrait)')` rotate-prompt overlay, install flow.

Give each subagent the relevant section of `docs/GAME_DESIGN.md` and the full
`docs/ARCHITECTURE.md` — don't summarize it down, they need the weapon-weakness
details (spin-up, cooldown windows, LOS-break behavior) to implement matchups
correctly, not just "make a minigun."

## Step 4 — integration
Once client and server agents finish:
1. Merge `feature/game-server` first — it's the authoritative source of truth,
   other work should integrate against it, not the reverse.
2. Merge `feature/game-client` and resolve the WebSocket contract against the actual
   server implementation (message shapes may drift slightly from spec during build —
   that's expected, reconcile it here).
3. Merge `feature/pwa-shell` last — it wraps the finished app, easiest to verify once
   the game itself works in a plain browser tab.
4. Deploy, then manually test: open on two phones, join the same match, play a full
   round including a death (verify level decay) and a shop purchase.
5. Verify "Add to Home Screen" on iOS Safari actually launches full-screen and
   respects the landscape hint (or shows the rotate overlay correctly).

## What "done" means
Match the Definition of Done checklist in `docs/ARCHITECTURE.md` exactly — don't
consider this finished until every item there is verified against a real deployed
build, not just code that compiles.

## Notes / open decisions the agents should make and document, not ask about
- Exact weapon numbers (damage, cooldown seconds, spread degrees, spin-up duration) —
  pick reasonable starting values, note them clearly in `shared/game-config.ts`
  comments, they're meant to be tuned after playtesting, not finalized now.
- Rounding direction for odd-level decay (round up vs down) — pick one, document it.
- Match end condition (kill count vs timer) — default to first-to-5-kills-or-5-minutes
  unless a better idea comes up during build.
