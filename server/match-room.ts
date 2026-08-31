import { DurableObject } from "cloudflare:workers";
import {
	CLASS_UNLOCK_LEVEL,
	cooldownAtLevel,
	damageAtLevel,
	decayLevelOnDeath,
	ECONOMY,
	MATCH_RULES,
	WEAPONS,
} from "../shared/game-config";
import type { ClientToServerMessage, PlayerState, ServerToClientMessage } from "../shared/protocol";

/**
 * One MatchRoom instance = one live match, addressed by match code via getByName().
 * Holds authoritative state and is the single source of truth both clients render from.
 *
 * WebSocket upgrade/accept plumbing below is done — this is the part that's easy to get subtly
 * wrong with the Hibernatable WebSockets API. What's NOT done, and is this module's actual job
 * (see docs/GAME_DESIGN.md + docs/ARCHITECTURE.md, "server" module boundary):
 *   - the authoritative tick loop (movement integration, nearest-target + LOS acquisition,
 *     projectile spawn/travel/hit resolution using WEAPONS stats from shared/game-config)
 *   - money/leveling, weapon purchases (ECONOMY), level decay on death (decayLevelOnDeath)
 *   - class specialization once a player reaches CLASS_UNLOCK_LEVEL
 *   - match end condition (MATCH_RULES.killsToWin / matchDurationMs) and broadcasting `matchEnd`
 *   - obstacles/line-of-sight geometry for the map (LOS breaking is core to the design, not
 *     cosmetic — see "Why auto-aim is fine" in docs/GAME_DESIGN.md)
 *
 * Tick loop note: at MATCH_RULES.matchTickMs (100ms) granularity, the Alarms API is too coarse —
 * use a `setInterval` started when the first player connects and cleared when the match ends or
 * empties out (standard pattern for short-lived realtime DOs; matches are capped at 5 minutes by
 * MATCH_RULES.matchDurationMs so this can't run away). Persist final state to storage on end/close
 * in case that matters for a later feature — not required for v1 since matches are ephemeral.
 */
export class MatchRoom extends DurableObject<Env> {
	private players = new Map<string, PlayerState>();
	private tickIntervalHandle: ReturnType<typeof setInterval> | null = null;
	private tick = 0;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		const playerId = crypto.randomUUID();
		this.ctx.acceptWebSocket(server, [playerId]);
		server.serializeAttachment({ playerId });

		// TODO(server): create the PlayerState entry, broadcast `joined`, start the tick loop
		// (setInterval) on first connection if not already running.

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string") return;
		const parsed = JSON.parse(message) as ClientToServerMessage;

		// TODO(server): dispatch on parsed.type ("join" | "input" | "buyWeaponLevel" |
		// "chooseClass"), referencing WEAPONS / damageAtLevel / cooldownAtLevel / ECONOMY /
		// CLASS_UNLOCK_LEVEL from shared/game-config as needed.
		void parsed;
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const { playerId } = (ws.deserializeAttachment() ?? {}) as { playerId?: string };
		if (playerId) this.players.delete(playerId);

		// TODO(server): broadcast updated state; stop the tick loop + clear tickIntervalHandle
		// once no sockets remain (this.ctx.getWebSockets().length === 0).
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		await this.webSocketClose(ws);
	}

	private broadcast(message: ServerToClientMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			ws.send(payload);
		}
	}
}
