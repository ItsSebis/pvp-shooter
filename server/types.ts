/**
 * Server-internal-only bookkeeping types. None of this needs to reach the client, so it's kept
 * as a parallel structure alongside (never merged into) the wire-shape PlayerState/
 * ProjectileState from shared/protocol.ts that gets broadcast every tick.
 */
import type { Vector2 } from "../shared/protocol";
import type { WeaponId } from "../shared/game-config";

export interface PlayerInternal {
	/** Timestamp (ms) this player's weapon last fired; gates cooldownAtLevel/effectiveCooldownMs. */
	lastFiredAtMs: number;
	/** Timestamp (ms) the current dash ends at; only meaningful while player.isDashing. */
	dashActiveUntilMs: number;
	/** Timestamp (ms) dash next becomes available; drives PlayerState.dashCooldownRemainingMs. */
	dashReadyAtMs: number;
	/** Raw joystick vector + dash flag from the latest `input` message received for this player. */
	lastInput: { moveVector: Vector2; dashPressed: boolean };
	/** dashPressed as of the previous tick, so a dash triggers on the rising edge, not every tick
	 * it's held (input messages can arrive more often than one per tick). */
	prevTickDashPressed: boolean;
	/** Id of the player currently targeted for auto-fire, or null if none. */
	currentTargetId: string | null;
	/** Timestamp (ms) LOS to currentTargetId became continuously clear; null while broken/no
	 * target — see MatchRoom's updateTargetingAndFiring for the losReacquireMs simplification. */
	losClearSinceMs: number | null;
	/** Ms of unbroken locked-and-firing engagement; resets to 0 the instant the lock drops.
	 * Drives the minigun's spin-up (effectiveCooldownMs) and spread growth (effectiveSpreadDegrees). */
	continuousFireMs: number;
	/** Confirmed kills this match, for killsToWin / matchEnd tiebreaking. */
	kills: number;
	/** Timestamp (ms) this player may respawn at; null while alive. */
	respawnAtMs: number | null;
	/** Index into SPAWN_POINTS this player currently occupies, used to avoid re-picking an
	 * occupied spawn on join/respawn. */
	spawnPointIndex: number;
}

export interface ProjectileInternal {
	ownerId: string;
	weapon: WeaponId;
	spawnPos: Vector2;
	/** Damage already resolved to the shooter's weapon level at fire time, before falloff. */
	baseDamage: number;
}

export interface PickupInternal {
	id: string;
	pos: Vector2;
	value: number;
	/** Timestamp (ms) this pickup becomes collectible again; null while active/visible. */
	respawnAtMs: number | null;
}
