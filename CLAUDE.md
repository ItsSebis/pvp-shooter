# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repository contains **only design/architecture docs, no code yet**. Before writing
any code, read `docs/start-here.md` — it is a Claude Code-specific execution plan
(scaffold order, worktree layout, subagent delegation, integration order) and is the
actual entry point for building this project. Read `docs/GAME_DESIGN.md` and
`docs/ARCHITECTURE.md` in full alongside it; the plan assumes both have been read
completely, not skimmed.

## What this is

A browser-based, PWA-installable 2D top-down PvP shooter for a small friend group.
Movement is via a single virtual joystick; weapons auto-fire at the nearest valid
target in range + line-of-sight — there is no manual aim. Skill instead comes from
dodging (projectiles have travel time/spread), breaking line-of-sight to drop enemy
target lock, reading weapon tells (windups/spin-ups), and dash timing.

## Architecture (once built)

- **Rendering**: Phaser 3, using `rexvirtualjoystickplugin` for the movement joystick.
- **App shell**: Next.js on Cloudflare Workers.
- **Multiplayer**: one Cloudflare Durable Object per active match holds authoritative
  state and relays it to both clients over WebSocket. Clients send only input (joystick
  vector, dash press); the Durable Object runs the authoritative tick — movement,
  target acquisition/LOS, projectile/damage resolution, money, leveling, level decay.
  This is intentional even for a friend-group game, to prevent a modified client from
  claiming extra damage.
- **PWA**: `manifest.json` (`orientation: landscape`) + a service worker caching the
  Phaser bundle/sprites/static assets only — multiplayer traffic is never cached.
  iOS PWAs can't force orientation, so portrait is detected via
  `matchMedia('(orientation: portrait)')` and handled with a rotate-prompt overlay,
  not a forced rotation.

## The shared config contract

Weapon stats, leveling tiers, and the level-decay formula must live in exactly one
module, `shared/game-config.ts`, imported by **both** the client (for
prediction/UI) and the Durable Object (for authoritative resolution). Never duplicate
these numbers across client and server — tuning must mean editing one file. This file
is meant to be built first, before any other module, since everything else imports it.

Level decay on death: `new_level = max(1, round(current_level / 2))`.

## Module boundaries

Per `docs/ARCHITECTURE.md`, the codebase is meant to split into `shared/`, `client/`,
`server/`, `pwa/` — in that build order, since each later module depends on the shared
config and (for client) on the server's WebSocket contract. `docs/start-here.md` maps
these onto git worktrees for parallel subagent work.

## Weapon design (rock-paper-scissors, not a stat ladder)

Every class trades power for a specific, learnable, exploitable weakness — this is
core to the game, not incidental:

| Class | Strength | Exploitable weakness |
|---|---|---|
| Shooter (starter) | Balanced, no tell | Reference point; no weakness |
| Sniper | High single-hit damage, scales with distance | Long cooldown; visible charge tell — rush it during cooldown |
| Shotgun | Big burst damage at close range | Falls off a cliff past close range — kite it |
| Minigun | Sustained DPS, low execution skill | Slow tracking, spread widens while firing, movement penalty; visible spin-up — juke during spin-up or dodge diagonally |

Exact numbers (damage, cooldowns, spread, spin-up duration) are explicitly *not*
finalized in the design doc — they're tuning parameters to be set once during
implementation and adjusted after playtesting, documented as code comments in
`shared/game-config.ts`, not treated as a spec to satisfy exactly.

## Definition of done

A build is only complete when it matches the Definition of "ready to play" checklist
at the bottom of `docs/ARCHITECTURE.md` against a real deployed build — two phones
joining the same match, playing a full round including a death and a shop purchase,
and installing via "Add to Home Screen" on iOS Safari. Passing compilation/tests is
not sufficient to call this done.
