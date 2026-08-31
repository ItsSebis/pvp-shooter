/**
 * The single arena layout, imported by both client (rendering) and server (line-of-sight
 * raycasting + collision). Obstacles must match exactly on both sides — LOS-breaking is a
 * core mechanic (see docs/GAME_DESIGN.md), not cosmetic, so a client-only visual obstacle
 * that the server doesn't know about would let a player "hide" without actually breaking
 * target lock, and vice versa.
 */

export interface RectObstacle {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const ARENA = {
	width: 1600,
	height: 900,
};

/** Deliberately placed to make LOS-breaking a real, usable tactic for both players. */
export const OBSTACLES: RectObstacle[] = [
	{ x: 700, y: 380, width: 200, height: 140 }, // center block
	{ x: 200, y: 150, width: 160, height: 40 },
	{ x: 200, y: 700, width: 160, height: 40 },
	{ x: 1240, y: 150, width: 160, height: 40 },
	{ x: 1240, y: 700, width: 160, height: 40 },
	{ x: 60, y: 400, width: 40, height: 160 },
	{ x: 1500, y: 400, width: 40, height: 160 },
];

export const SPAWN_POINTS: { x: number; y: number }[] = [
	{ x: 100, y: 100 },
	{ x: 1500, y: 800 },
	{ x: 1500, y: 100 },
	{ x: 100, y: 800 },
];

export const SHOP_ZONES: { x: number; y: number; radius: number }[] = [
	{ x: 800, y: 100, radius: 60 },
	{ x: 800, y: 800, radius: 60 },
];
