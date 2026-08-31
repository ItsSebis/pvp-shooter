/**
 * Server-only tuning constants.
 *
 * These are implementation details of the authoritative simulation (hitbox sizes, pickup
 * layout, respawn delay, minigun turn-rate) rather than part of the shared game-config.ts
 * balance contract. `shared/` is out of scope for this module (owned by a parallel
 * workstream), and none of these numbers need to be a client-tunable "balance" value — the
 * ones that do reach the client already do so via existing wire fields on PlayerState
 * (e.g. `pos`, `facing`).
 */
import type { Vector2 } from "../shared/protocol";

/** Radius used for player-vs-projectile hit detection and player-vs-obstacle collision. */
export const PLAYER_HITBOX_RADIUS = 20;

/** Radius used for player-vs-pickup collection checks. */
export const PICKUP_COLLECT_RADIUS = 24;

/** How long a dead player waits before respawning, in ms. */
export const RESPAWN_DELAY_MS = 2000;

/** How long a collected money pickup takes to respawn, in ms. */
export const PICKUP_RESPAWN_MS = 10_000;

/**
 * Fixed pickup spawn locations. Chosen clear of every OBSTACLES rect and away from
 * SPAWN_POINTS/SHOP_ZONES in shared/map.ts so pickups are always reachable and visible.
 */
export const PICKUP_SPAWN_POINTS: Vector2[] = [
	{ x: 400, y: 450 },
	{ x: 1200, y: 450 },
	{ x: 800, y: 300 },
	{ x: 800, y: 650 },
];

/**
 * Baseline facing turn rate (degrees/sec) applied only while a minigun is actively engaged
 * with a locked target — this is what makes `trackingPenaltyWhileFiring` a real, learnable
 * weakness. Every other weapon (and the minigun when idle) snaps facing instantly to the
 * target, since there's no manual-aim skill to model otherwise (see docs/GAME_DESIGN.md,
 * "Why auto-aim is fine"). This value has no shared-config equivalent, so it's picked here:
 * fast enough to track a stationary target easily, slow enough that a diagonally-juking
 * target can visibly outrun the minigun's aim.
 */
export const MINIGUN_BASE_TURN_RATE_DEG_PER_SEC = 260;

/** Multiplier applied to base cooldown at the very start of a minigun's spin-up (cold start). */
export const MINIGUN_COLD_COOLDOWN_MULTIPLIER = 3;

/** Cap on spread growth for a continuously-firing minigun, so long bursts don't become absurd. */
export const MINIGUN_MAX_SPREAD_DEGREES = 40;
