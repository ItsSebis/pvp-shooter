/**
 * Weapon-specific combat math: distance-based damage falloff, and the minigun's spin-up /
 * spread-growth mechanics. Pure functions over shared/game-config.ts's WeaponStats so they're
 * cleanly unit-testable in isolation from the tick loop.
 */
import { cooldownAtLevel, type WeaponStats } from "../shared/game-config";
import {
	MINIGUN_COLD_COOLDOWN_MULTIPLIER,
	MINIGUN_MAX_SPREAD_DEGREES,
} from "./constants";

/**
 * Effective per-hit damage for a projectile, applying the weapon's distance falloff.
 * `travelDistancePx` is how far the projectile has actually flown at the moment of the hit
 * (distance from its spawn point, not the distance between the two players at fire time) —
 * both the sniper's growth and the shotgun's cliff key off real projectile flight, so e.g. a
 * shotgun pellet that flies further before connecting because the target backpedaled still
 * falls off correctly.
 */
export function applyDamageFalloff(
	weapon: WeaponStats,
	baseDamage: number,
	travelDistancePx: number,
): number {
	if (
		weapon.id === "sniper" &&
		weapon.damagePerPxBeyond !== undefined &&
		weapon.sniperFalloffStartPx !== undefined
	) {
		// Sniper damage *grows* with distance past the start px — matches the design doc
		// ("damage scales up with distance, still hits hard up close"), not a falloff despite
		// the field family name.
		const beyond = Math.max(0, travelDistancePx - weapon.sniperFalloffStartPx);
		return baseDamage + weapon.damagePerPxBeyond * beyond;
	}
	if (
		weapon.id === "shotgun" &&
		weapon.shotgunFalloffMultiplierPastRange !== undefined &&
		weapon.shotgunFalloffStartPx !== undefined
	) {
		// "Falls off a cliff past close range" per the design doc — a hard step down at the
		// threshold, not a gradual per-pixel curve like the sniper's growth.
		return travelDistancePx > weapon.shotgunFalloffStartPx
			? baseDamage * weapon.shotgunFalloffMultiplierPastRange
			: baseDamage;
	}
	return baseDamage;
}

/**
 * Effective fire cooldown for a shot, given how long (ms) the weapon has been continuously
 * locked onto a target. Only the minigun varies: it starts at MINIGUN_COLD_COOLDOWN_MULTIPLIER
 * times slower and linearly ramps down to its full leveled rate-of-fire over `spinUpMs` — the
 * visible, punishable "spin-up" tell from the design doc. Every other weapon fires at its flat
 * leveled cooldown regardless of how long it's been engaged.
 */
export function effectiveCooldownMs(
	weapon: WeaponStats,
	level: number,
	continuousFireMs: number,
): number {
	const base = cooldownAtLevel(weapon, level);
	if (weapon.id !== "minigun" || weapon.spinUpMs === undefined) return base;

	const spinFactor = Math.min(1, Math.max(0, continuousFireMs / weapon.spinUpMs));
	const coldMultiplier = MINIGUN_COLD_COOLDOWN_MULTIPLIER;
	return base * (coldMultiplier - (coldMultiplier - 1) * spinFactor);
}

/**
 * Effective shot spread in degrees, growing over continuous minigun fire (spreadGrowthPerSecond)
 * and capped so a long sustained burst can't become absurd. Every other weapon just returns its
 * flat configured spread.
 */
export function effectiveSpreadDegrees(weapon: WeaponStats, continuousFireMs: number): number {
	if (weapon.id !== "minigun" || weapon.spreadGrowthPerSecond === undefined) {
		return weapon.spreadDegrees;
	}
	const grown = weapon.spreadDegrees + weapon.spreadGrowthPerSecond * (continuousFireMs / 1000);
	return Math.min(MINIGUN_MAX_SPREAD_DEGREES, grown);
}
