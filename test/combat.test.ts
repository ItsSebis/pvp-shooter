import { describe, expect, it } from "vitest";
import { applyDamageFalloff, effectiveCooldownMs, effectiveSpreadDegrees } from "../server/combat";
import {
	cooldownAtLevel,
	damageAtLevel,
	decayLevelOnDeath,
	WEAPONS,
} from "../shared/game-config";
import { MINIGUN_COLD_COOLDOWN_MULTIPLIER, MINIGUN_MAX_SPREAD_DEGREES } from "../server/constants";

describe("applyDamageFalloff — sniper (damage grows with distance)", () => {
	const sniper = WEAPONS.sniper;

	it("returns base damage at or under the falloff start distance", () => {
		expect(applyDamageFalloff(sniper, 35, 0)).toBe(35);
		expect(applyDamageFalloff(sniper, 35, sniper.sniperFalloffStartPx!)).toBe(35);
	});

	it("adds damagePerPxBeyond for every px past the start distance", () => {
		const beyond = 100;
		const expected = 35 + sniper.damagePerPxBeyond! * beyond;
		expect(applyDamageFalloff(sniper, 35, sniper.sniperFalloffStartPx! + beyond)).toBeCloseTo(
			expected,
		);
	});
});

describe("applyDamageFalloff — shotgun (cliff falloff past range)", () => {
	const shotgun = WEAPONS.shotgun;

	it("returns full base damage at or under the falloff start distance", () => {
		expect(applyDamageFalloff(shotgun, 28, 0)).toBe(28);
		expect(applyDamageFalloff(shotgun, 28, shotgun.shotgunFalloffStartPx!)).toBe(28);
	});

	it("drops to a flat multiplier of base damage just past the start distance (a cliff, not a curve)", () => {
		const justPast = applyDamageFalloff(shotgun, 28, shotgun.shotgunFalloffStartPx! + 1);
		const wayPast = applyDamageFalloff(shotgun, 28, shotgun.shotgunFalloffStartPx! + 100);
		expect(justPast).toBeCloseTo(28 * shotgun.shotgunFalloffMultiplierPastRange!);
		// Cliff, not a gradual curve: damage past the threshold doesn't keep dropping with distance.
		expect(wayPast).toBeCloseTo(justPast);
	});
});

describe("applyDamageFalloff — shooter (no falloff fields, damage is flat)", () => {
	it("ignores distance entirely", () => {
		const shooter = WEAPONS.shooter;
		expect(applyDamageFalloff(shooter, 10, 0)).toBe(10);
		expect(applyDamageFalloff(shooter, 10, 10_000)).toBe(10);
	});
});

describe("effectiveCooldownMs — minigun spin-up", () => {
	const minigun = WEAPONS.minigun;

	it("fires at MINIGUN_COLD_COOLDOWN_MULTIPLIER times the leveled cooldown when cold (0ms engaged)", () => {
		const base = cooldownAtLevel(minigun, 1);
		expect(effectiveCooldownMs(minigun, 1, 0)).toBeCloseTo(base * MINIGUN_COLD_COOLDOWN_MULTIPLIER);
	});

	it("reaches the flat leveled cooldown once continuousFireMs >= spinUpMs", () => {
		const base = cooldownAtLevel(minigun, 1);
		expect(effectiveCooldownMs(minigun, 1, minigun.spinUpMs!)).toBeCloseTo(base);
		expect(effectiveCooldownMs(minigun, 1, minigun.spinUpMs! * 5)).toBeCloseTo(base); // clamped, doesn't overshoot below base
	});

	it("interpolates monotonically between cold and full rate as continuousFireMs grows", () => {
		const half = effectiveCooldownMs(minigun, 1, minigun.spinUpMs! / 2);
		const cold = effectiveCooldownMs(minigun, 1, 0);
		const full = effectiveCooldownMs(minigun, 1, minigun.spinUpMs!);
		expect(half).toBeLessThan(cold);
		expect(half).toBeGreaterThan(full);
	});

	it("leaves non-minigun weapons at their flat leveled cooldown regardless of continuousFireMs", () => {
		const sniper = WEAPONS.sniper;
		expect(effectiveCooldownMs(sniper, 1, 0)).toBe(cooldownAtLevel(sniper, 1));
		expect(effectiveCooldownMs(sniper, 1, 10_000)).toBe(cooldownAtLevel(sniper, 1));
	});
});

describe("effectiveSpreadDegrees — minigun spread growth", () => {
	const minigun = WEAPONS.minigun;

	it("starts at the weapon's base spread with no continuous fire", () => {
		expect(effectiveSpreadDegrees(minigun, 0)).toBe(minigun.spreadDegrees);
	});

	it("grows linearly with spreadGrowthPerSecond", () => {
		const afterOneSecond = effectiveSpreadDegrees(minigun, 1000);
        expect(afterOneSecond).toBeCloseTo(minigun.spreadDegrees + minigun.spreadGrowthPerSecond!);
	});

	it("caps at MINIGUN_MAX_SPREAD_DEGREES on a long sustained burst", () => {
		expect(effectiveSpreadDegrees(minigun, 10 * 60 * 1000)).toBe(MINIGUN_MAX_SPREAD_DEGREES);
	});

	it("leaves non-minigun weapons at their flat configured spread", () => {
		expect(effectiveSpreadDegrees(WEAPONS.shotgun, 5000)).toBe(WEAPONS.shotgun.spreadDegrees);
	});
});

describe("damageAtLevel / cooldownAtLevel scaling used by the server", () => {
	it("increases damage by LEVEL_STAT_STEP per level, capped at MAX_WEAPON_LEVEL", () => {
		const shooter = WEAPONS.shooter;
		const l1 = damageAtLevel(shooter, 1);
		const l2 = damageAtLevel(shooter, 2);
		const l4 = damageAtLevel(shooter, 4);
		const l99 = damageAtLevel(shooter, 99); // clamps to MAX_WEAPON_LEVEL
		expect(l2).toBeGreaterThan(l1);
		expect(l4).toBeGreaterThan(l2);
		expect(l99).toBe(l4);
	});

	it("decreases cooldown as level increases, capped at MAX_WEAPON_LEVEL", () => {
		const shooter = WEAPONS.shooter;
		const l1 = cooldownAtLevel(shooter, 1);
		const l4 = cooldownAtLevel(shooter, 4);
		const l99 = cooldownAtLevel(shooter, 99);
		expect(l4).toBeLessThan(l1);
		expect(l99).toBe(l4);
	});
});

describe("decayLevelOnDeath usage (server applies this directly on player death)", () => {
	it("halves and floors, matching the design doc's stated examples", () => {
		expect(decayLevelOnDeath(16)).toBe(8);
		expect(decayLevelOnDeath(4)).toBe(2);
	});

	it("never decays below level 1", () => {
		expect(decayLevelOnDeath(1)).toBe(1);
	});

	it("rounds down on odd levels", () => {
		expect(decayLevelOnDeath(5)).toBe(2);
	});
});
