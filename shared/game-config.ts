/**
 * Single source of truth for weapon stats, leveling, decay, economy, and match rules.
 * Imported by both client/ (prediction + UI display) and server/ (authoritative resolution).
 * Never duplicate these numbers anywhere else — tune by editing this file only.
 *
 * All numeric values below are starting/tuning values, not final balance — pick reasonable
 * defaults now, iterate after playtesting with the actual friend group (see docs/GAME_DESIGN.md).
 */

export type WeaponId = "shooter" | "sniper" | "shotgun" | "minigun";

export interface WeaponStats {
  id: WeaponId;
  displayName: string;
  /** Base damage per projectile hit, before level multiplier. */
  damage: number;
  /** Milliseconds between shots at level 1 (this IS the "cooldown window" opponents exploit). */
  cooldownMs: number;
  /** Projectile travel speed in px/s. Projectiles have real travel time — never hitscan. */
  projectileSpeed: number;
  /** Max engagement range in px; auto-fire never targets beyond this. */
  range: number;
  /** Random spread applied per shot, in degrees (half-angle). 0 = perfectly accurate. */
  spreadDegrees: number;
  /** Time in ms the weapon must re-acquire a target after LOS is broken. */
  losReacquireMs: number;
  /** Sniper-only: extra damage per px of distance beyond `sniperFalloffStartPx` (0 for others). */
  damagePerPxBeyond?: number;
  sniperFalloffStartPx?: number;
  /** Shotgun-only: multiplier applied to damage past `shotgunFalloffStartPx` (1 = no falloff). */
  shotgunFalloffMultiplierPastRange?: number;
  shotgunFalloffStartPx?: number;
  /** Minigun-only: time to reach full rate-of-fire / accuracy from a cold start, in ms. */
  spinUpMs?: number;
  /** Minigun-only: turn speed penalty while spun up, as a fraction of normal turn rate (0-1). */
  trackingPenaltyWhileFiring?: number;
  /** Minigun-only: extra spread degrees added per second of continuous firing (resets on stop). */
  spreadGrowthPerSecond?: number;
}

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  shooter: {
    id: "shooter",
    displayName: "Shooter",
    damage: 10,
    cooldownMs: 500,
    projectileSpeed: 600,
    range: 420,
    spreadDegrees: 2,
    losReacquireMs: 150,
  },
  sniper: {
    id: "sniper",
    displayName: "Sniper",
    damage: 35,
    cooldownMs: 1800,
    projectileSpeed: 1200,
    range: 700,
    spreadDegrees: 0,
    losReacquireMs: 150,
    damagePerPxBeyond: 0.04,
    sniperFalloffStartPx: 300,
  },
  shotgun: {
    id: "shotgun",
    displayName: "Shotgun",
    damage: 28,
    cooldownMs: 700,
    projectileSpeed: 500,
    range: 260,
    spreadDegrees: 10,
    losReacquireMs: 150,
    shotgunFalloffMultiplierPastRange: 0.15,
    shotgunFalloffStartPx: 180,
  },
  minigun: {
    id: "minigun",
    displayName: "Minigun",
    damage: 6,
    cooldownMs: 120,
    projectileSpeed: 700,
    range: 380,
    spreadDegrees: 1,
    losReacquireMs: 150,
    spinUpMs: 900,
    trackingPenaltyWhileFiring: 0.5,
    spreadGrowthPerSecond: 6,
  },
};

/** Level at which a player may specialize from Shooter into one other class. */
export const CLASS_UNLOCK_LEVEL = 3;

/** Max weapon level; stats scale linearly between tiers below, capped at this tier. */
export const MAX_WEAPON_LEVEL = 4;

/** Per-level stat multiplier for damage/cooldown-reduction, applied as (1 + (level-1) * step). */
export const LEVEL_STAT_STEP = 0.1; // +10% per level, hard-capped at MAX_WEAPON_LEVEL

/** Returns a weapon's effective damage at a given level (1..MAX_WEAPON_LEVEL). */
export function damageAtLevel(weapon: WeaponStats, level: number): number {
  const clamped = Math.min(Math.max(level, 1), MAX_WEAPON_LEVEL);
  return weapon.damage * (1 + (clamped - 1) * LEVEL_STAT_STEP);
}

/** Returns a weapon's effective cooldown (ms) at a given level; cooldown shrinks with level. */
export function cooldownAtLevel(weapon: WeaponStats, level: number): number {
  const clamped = Math.min(Math.max(level, 1), MAX_WEAPON_LEVEL);
  return weapon.cooldownMs * (1 - (clamped - 1) * (LEVEL_STAT_STEP / 2));
}

/**
 * Level decay on death: halves current level, rounding DOWN on odd levels (friendlier — the
 * design doc left rounding direction as an open decision; picked down over up so a death is
 * punishing but not needlessly harsh for a casual friend-group game). Clamped to a minimum of 1.
 * Matches the doc's stated examples exactly: 16 -> 8, 4 -> 2.
 */
export function decayLevelOnDeath(currentLevel: number): number {
  return Math.max(1, Math.floor(currentLevel / 2));
}

export const ECONOMY = {
  /** Money awarded to the killer on a kill. */
  killReward: 50,
  /** Money awarded per pickup collected on the map. */
  pickupValue: 10,
  /** Passive money awarded per tick survived (see `matchTickMs`). */
  surviveTickReward: 1,
  /** Cost in money to buy one weapon level via a shop zone. */
  weaponLevelCost: 40,
};

export const MATCH_RULES = {
  /** Server authoritative simulation tick rate, in ms. */
  matchTickMs: 100,
  /** First-to-N-kills condition. */
  killsToWin: 5,
  /** Or a hard timer, in ms, whichever comes first (see start-here.md default). */
  matchDurationMs: 5 * 60 * 1000,
  /** Player max health at level 1; does not scale with level (levels affect weapons, not HP). */
  maxHealth: 100,
  /** Dash: short cooldown, the one manual timing-skill input layered on auto-aim. */
  dashCooldownMs: 3000,
  dashDurationMs: 200,
  dashSpeedMultiplier: 3,
  /** Base movement speed in px/s. */
  moveSpeed: 220,
};
