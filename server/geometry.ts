/**
 * Vector math, collision, and line-of-sight helpers for the authoritative simulation.
 * Pure functions only (no DO state) so they're cleanly unit-testable in isolation.
 */
import type { Vector2 } from "../shared/protocol";
import type { RectObstacle } from "../shared/map";
import { ARENA, OBSTACLES } from "../shared/map";

export function add(a: Vector2, b: Vector2): Vector2 {
	return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vector2, b: Vector2): Vector2 {
	return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vector2, s: number): Vector2 {
	return { x: v.x * s, y: v.y * s };
}

export function length(v: Vector2): number {
	return Math.hypot(v.x, v.y);
}

export function normalize(v: Vector2): Vector2 {
	const len = length(v);
	if (len < 1e-9) return { x: 0, y: 0 };
	return { x: v.x / len, y: v.y / len };
}

export function distance(a: Vector2, b: Vector2): number {
	return length(sub(a, b));
}

/** Rotate a vector by `degrees`. Only used to apply random symmetric spread to an aim direction
 * — the rotation's absolute sense (CW vs CCW) is irrelevant since spread is symmetric. */
export function rotate(v: Vector2, degrees: number): Vector2 {
	const rad = (degrees * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** Angle of a vector in degrees, per atan2 convention. */
export function angleOfDeg(v: Vector2): number {
	return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

/** Wrap an angle (degrees) into (-180, 180]. */
export function wrapAngleDeg(deg: number): number {
	let d = deg % 360;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	return d;
}

/** Circle (center c, radius r) vs axis-aligned rect overlap test. */
export function circleIntersectsRect(c: Vector2, r: number, rect: RectObstacle): boolean {
	const closestX = Math.max(rect.x, Math.min(c.x, rect.x + rect.width));
	const closestY = Math.max(rect.y, Math.min(c.y, rect.y + rect.height));
	const dx = c.x - closestX;
	const dy = c.y - closestY;
	return dx * dx + dy * dy < r * r;
}

export function clampToArena(pos: Vector2, radius: number): Vector2 {
	return {
		x: Math.min(Math.max(pos.x, radius), ARENA.width - radius),
		y: Math.min(Math.max(pos.y, radius), ARENA.height - radius),
	};
}

/**
 * Resolve a desired move from `from` to `to` against `obstacles`, clamped to the arena.
 * Simple axis-separated AABB resolution (spec explicitly allows this): try the full move, then
 * X-only, then Y-only, so a player sliding into a wall at an angle slides along it instead of
 * getting stuck dead against it. Falls back to not moving at all if every option is blocked.
 */
export function resolveMovement(
	from: Vector2,
	to: Vector2,
	radius: number,
	obstacles: RectObstacle[],
): Vector2 {
	const blocked = (p: Vector2) => obstacles.some((o) => circleIntersectsRect(p, radius, o));

	const clampedTo = clampToArena(to, radius);
	if (!blocked(clampedTo)) return clampedTo;

	const xOnly = clampToArena({ x: clampedTo.x, y: from.y }, radius);
	if (!blocked(xOnly)) return xOnly;

	const yOnly = clampToArena({ x: from.x, y: clampedTo.y }, radius);
	if (!blocked(yOnly)) return yOnly;

	return from;
}

/**
 * Segment-vs-AABB intersection (slab/Liang-Barsky method), restricted to the segment p1->p2
 * (not the infinite line). Returns true if the segment crosses the rectangle at all — used for
 * line-of-sight raycasts, where any obstacle intersection blocks LOS entirely (no partial
 * credit for grazing a corner).
 */
export function segmentIntersectsRect(p1: Vector2, p2: Vector2, rect: RectObstacle): boolean {
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	let tMin = 0;
	let tMax = 1;

	const axes: [number, number, number, number][] = [
		[p1.x, dx, rect.x, rect.x + rect.width],
		[p1.y, dy, rect.y, rect.y + rect.height],
	];

	for (const [origin, delta, min, max] of axes) {
		if (Math.abs(delta) < 1e-9) {
			// Segment is parallel to this axis' slab boundaries — only valid if already inside it.
			if (origin < min || origin > max) return false;
			continue;
		}
		let t1 = (min - origin) / delta;
		let t2 = (max - origin) / delta;
		if (t1 > t2) [t1, t2] = [t2, t1];
		tMin = Math.max(tMin, t1);
		tMax = Math.min(tMax, t2);
		if (tMin > tMax) return false;
	}
	return true;
}

/** True if the straight line between a and b is blocked by any OBSTACLES rectangle. */
export function hasLineOfSight(a: Vector2, b: Vector2): boolean {
	return !OBSTACLES.some((rect) => segmentIntersectsRect(a, b, rect));
}
