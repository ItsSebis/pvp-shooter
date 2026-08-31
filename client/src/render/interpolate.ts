import type { PlayerState, ProjectileState, ServerToClientMessage } from "../../../shared/protocol";

type StateMessage = Extract<ServerToClientMessage, { type: "state" }>;

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, v));
}

/**
 * Interpolates player/projectile positions between two buffered `state` snapshots at a fixed
 * render delay behind the latest one (standard "entity interpolation") so remote motion reads as
 * smooth movement instead of a snap once per server tick (100ms). Only position is interpolated —
 * health/money/weapon/etc always reflect the latest snapshot, and an entity not present in the
 * older snapshot (just spawned/joined/fired) renders at its latest position with no interpolation.
 */
export function interpolateSnapshots(
	snapshots: StateMessage[],
	renderTimeMs: number,
): { players: PlayerState[]; projectiles: ProjectileState[] } {
	const latest = snapshots[snapshots.length - 1];
	if (!latest) return { players: [], projectiles: [] };
	if (snapshots.length === 1) return { players: latest.players, projectiles: latest.projectiles };

	let a = snapshots[0];
	let b = snapshots[snapshots.length - 1];
	for (let i = 0; i < snapshots.length - 1; i++) {
		if (snapshots[i].serverTimeMs <= renderTimeMs && renderTimeMs <= snapshots[i + 1].serverTimeMs) {
			a = snapshots[i];
			b = snapshots[i + 1];
			break;
		}
	}
	if (a === b) a = snapshots[snapshots.length - 2] ?? b;

	const span = b.serverTimeMs - a.serverTimeMs;
	// Clamp allows slight extrapolation (up to 1.5x the bracket span) past the latest snapshot
	// when renderTimeMs runs ahead of buffered data (e.g. a slow network tick) rather than
	// freezing at the last known position.
	const t = span > 0 ? clamp((renderTimeMs - a.serverTimeMs) / span, 0, 1.5) : 1;

	const players = b.players.map((bp) => {
		const ap = a.players.find((p) => p.id === bp.id);
		if (!ap) return bp;
		return { ...bp, pos: { x: lerp(ap.pos.x, bp.pos.x, t), y: lerp(ap.pos.y, bp.pos.y, t) } };
	});

	const projectiles = b.projectiles.map((bp) => {
		const ap = a.projectiles.find((p) => p.id === bp.id);
		if (!ap) return bp;
		return { ...bp, pos: { x: lerp(ap.pos.x, bp.pos.x, t), y: lerp(ap.pos.y, bp.pos.y, t) } };
	});

	return { players, projectiles };
}
