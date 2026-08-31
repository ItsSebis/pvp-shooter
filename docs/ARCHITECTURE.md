# Architecture

## Stack decisions
- **Rendering / game engine**: Phaser 3 (canvas/WebGL 2D engine). Well-documented,
  has a virtual-joystick plugin (`rexvirtualjoystickplugin`), handles sprite/physics/
  collision out of the box — avoids hand-rolling a render loop.
- **App shell**: Next.js, deployed to Cloudflare Workers (or Vercel — pick whichever
  is already set up; Cloudflare is preferred if real-time multiplayer uses Durable
  Objects, to keep everything in one platform).
- **Realtime multiplayer**: Cloudflare Durable Objects, one instance per active match,
  holding authoritative match state and relaying state over WebSockets to both
  clients. This avoids needing a standalone game server.
  - Client sends only input (joystick vector, dash press) to the Durable Object.
  - Durable Object runs the authoritative simulation tick (movement, auto-target
    acquisition, projectile hits, damage, money, level decay) and broadcasts state.
  - Keeping simulation authoritative server-side prevents trivial client-side cheating
    (e.g. a modified client claiming extra damage) — worth doing even for a
    friend-group game, it's not much extra work if built in from the start.
- **PWA**: `manifest.json` (`display: standalone`, `orientation: landscape`) + a
  minimal service worker for the app shell (cache the Phaser bundle, sprites, and
  static assets; multiplayer traffic itself is never cached).

## Shared config
Weapon stats, leveling tiers, and the level-decay formula live in **one shared
TypeScript module** imported by both the client (for prediction/UI) and the Durable
Object (for authoritative resolution). Never duplicate these numbers — tuning should
mean editing one file, not two.

```
/shared/game-config.ts   <- weapon stats, level tiers, decay formula, constants
```

## Suggested module boundaries
These map directly onto the worktree/subagent plan in `start-here.md`:

1. **`shared/`** — game-config.ts (weapon stats, leveling, decay curve), shared types.
   Build first — everything else imports from it.
2. **`client/`** — Phaser scene(s), joystick + dash input handling, HUD, shop UI,
   sprite/asset loading, connects to the Durable Object over WebSocket.
3. **`server/`** — Durable Object: match state, authoritative tick loop, target
   acquisition + LOS checks, projectile resolution, money/leveling/decay logic.
4. **`pwa/`** — manifest.json, service worker, install flow, orientation-lock fallback
   overlay, icons.

## Definition of "ready to play"
- Two players can each open the deployed URL on a phone.
- Both can join the same match (simplest: a shareable match-code URL).
- Movement via joystick, auto-fire at nearest valid target in range + LOS, works.
- At least Shooter + one other weapon class implemented with its distinct
  weakness (spin-up, cooldown, or falloff) actually functioning, not just cosmetic.
- Money collection + at least one shop upgrade purchasable in-match.
- Death → respawn at halved level (clamped to min 1) works.
- Site is installable via "Add to Home Screen" on iOS Safari and opens full-screen.
