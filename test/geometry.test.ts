import { describe, expect, it } from "vitest";
import {
	circleIntersectsRect,
	hasLineOfSight,
	resolveMovement,
	segmentIntersectsRect,
} from "../server/geometry";
import { OBSTACLES } from "../shared/map";

describe("segmentIntersectsRect", () => {
	const rect = { x: 100, y: 100, width: 50, height: 50 }; // covers x:[100,150] y:[100,150]

	it("detects a segment that passes straight through the rect", () => {
		expect(segmentIntersectsRect({ x: 50, y: 125 }, { x: 200, y: 125 }, rect)).toBe(true);
	});

	it("misses a segment that passes entirely above the rect", () => {
		expect(segmentIntersectsRect({ x: 50, y: 50 }, { x: 200, y: 50 }, rect)).toBe(false);
	});

	it("misses a segment that stops short of the rect", () => {
		expect(segmentIntersectsRect({ x: 50, y: 125 }, { x: 90, y: 125 }, rect)).toBe(false);
	});

	it("misses a segment that starts past the rect", () => {
		expect(segmentIntersectsRect({ x: 160, y: 125 }, { x: 200, y: 125 }, rect)).toBe(false);
	});

	it("detects a diagonal segment clipping a corner", () => {
		expect(segmentIntersectsRect({ x: 80, y: 80 }, { x: 130, y: 130 }, rect)).toBe(true);
	});

	it("detects a segment fully contained inside the rect", () => {
		expect(segmentIntersectsRect({ x: 110, y: 110 }, { x: 140, y: 140 }, rect)).toBe(true);
	});

	it("treats a vertical segment parallel to the rect's edges correctly", () => {
		// x=125 is inside the rect's x-slab; segment spans the rect's y-range -> should hit.
		expect(segmentIntersectsRect({ x: 125, y: 0 }, { x: 125, y: 300 }, rect)).toBe(true);
		// x=200 is outside the rect's x-slab entirely -> should miss regardless of y-span.
		expect(segmentIntersectsRect({ x: 200, y: 0 }, { x: 200, y: 300 }, rect)).toBe(false);
	});
});

describe("hasLineOfSight (against the real map's OBSTACLES)", () => {
	it("is clear between two points with nothing between them", () => {
		// x=500 doesn't intersect any OBSTACLES rect's x-range at all.
		expect(hasLineOfSight({ x: 500, y: 50 }, { x: 500, y: 850 })).toBe(true);
	});

	it("is blocked by the center block when sightline crosses it", () => {
		// Center block is { x:700, y:380, width:200, height:140 } -> spans x:[700,900] y:[380,520].
		expect(hasLineOfSight({ x: 500, y: 450 }, { x: 1100, y: 450 })).toBe(false);
	});

	it("is clear when going around the center block", () => {
		expect(hasLineOfSight({ x: 500, y: 100 }, { x: 1100, y: 100 })).toBe(true);
	});
});

describe("circleIntersectsRect", () => {
	const rect = { x: 0, y: 0, width: 100, height: 100 };

	it("detects overlap when the circle center is inside the rect", () => {
		expect(circleIntersectsRect({ x: 50, y: 50 }, 5, rect)).toBe(true);
	});

	it("detects overlap when the circle just grazes an edge", () => {
		expect(circleIntersectsRect({ x: 105, y: 50 }, 10, rect)).toBe(true);
	});

	it("finds no overlap when clearly separated", () => {
		expect(circleIntersectsRect({ x: 200, y: 200 }, 10, rect)).toBe(false);
	});
});

describe("resolveMovement", () => {
	const obstacles = [{ x: 100, y: 100, width: 100, height: 100 }]; // x:[100,200] y:[100,200]

	it("allows free movement when nothing blocks it", () => {
		const result = resolveMovement({ x: 0, y: 0 }, { x: 10, y: 10 }, 5, obstacles);
		expect(result).toEqual({ x: 10, y: 10 });
	});

	it("slides along an obstacle instead of stopping dead when moving diagonally into it", () => {
		// Diagonal move toward the rect's top-left corner: the full diagonal is blocked (radius
		// puts the destination inside the rect's left-edge margin), but the X-only component
		// lands clear of the rect, so movement should still partially go through on that axis.
		const from = { x: 50, y: 50 };
		const to = { x: 95, y: 150 };
		const result = resolveMovement(from, to, 10, obstacles);
		expect(result).toEqual({ x: 95, y: 50 });
	});

	it("refuses to move fully into an obstacle with no valid axis-separated alternative", () => {
		// Diagonal move toward the rect's top-left corner where, with a large enough radius, even
		// each axis-only component still clips the corner — no partial move is safe.
		const from = { x: 85, y: 85 };
		const to = { x: 115, y: 115 };
		const result = resolveMovement(from, to, 20, obstacles);
		expect(result).toEqual(from);
	});
});
