import { DurableObject } from "cloudflare:workers";
import {
	CLASS_UNLOCK_LEVEL,
	damageAtLevel,
	decayLevelOnDeath,
	ECONOMY,
	MATCH_RULES,
	MAX_WEAPON_LEVEL,
	WEAPONS,
	type WeaponId,
	type WeaponStats,
} from "../shared/game-config";
import { ARENA, OBSTACLES, SHOP_ZONES, SPAWN_POINTS } from "../shared/map";
import type {
	ClientToServerMessage,
	PlayerState,
	ProjectileState,
	ServerToClientMessage,
	Vector2,
} from "../shared/protocol";
import { effectiveCooldownMs, effectiveSpreadDegrees, applyDamageFalloff } from "./combat";
import {
	MINIGUN_BASE_TURN_RATE_DEG_PER_SEC,
	PICKUP_COLLECT_RADIUS,
	PICKUP_RESPAWN_MS,
	PICKUP_SPAWN_POINTS,
	PLAYER_HITBOX_RADIUS,
	RESPAWN_DELAY_MS,
} from "./constants";
import {
	add,
	angleOfDeg,
	distance,
	length,
	normalize,
	resolveMovement,
	rotate,
	scale,
	sub,
	hasLineOfSight,
	wrapAngleDeg,
} from "./geometry";
import { randomFloat, randomSymmetric } from "./rng";
import type { PickupInternal, PlayerInternal, ProjectileInternal } from "./types";

/**
 * One MatchRoom instance = one live match, addressed by match code via getByName(). Holds
 * authoritative state and is the single source of truth both clients render from.
 *
 * Match code: the DO itself is never told its own name by the platform, so the match code is
 * captured from the `?match=` query param on the very first WebSocket upgrade request this
 * instance receives (server/index.ts forwards the original Request unchanged) and cached on
 * the instance for the lifetime of the match. This is simplest given the DO is created fresh
 * per match and torn down when it empties out — no need to persist it to storage.
 *
 * Tick loop: at MATCH_RULES.matchTickMs (100ms) granularity the Alarms API is too coarse, so a
 * plain `setInterval` is started on first join and cleared once the match ends or every socket
 * disconnects (matches are capped at MATCH_RULES.matchDurationMs so this can never run away).
 */
export class MatchRoom extends DurableObject<Env> {
	private players = new Map<string, PlayerState>();
	private playerInternal = new Map<string, PlayerInternal>();
	private projectiles = new Map<string, ProjectileState>();
	private projectileInternal = new Map<string, ProjectileInternal>();
	private pickups: PickupInternal[] = PICKUP_SPAWN_POINTS.map((pos, i) => ({
		id: `pickup-${i}`,
		pos,
		value: ECONOMY.pickupValue,
		respawnAtMs: null,
	}));

	private matchCode: string | null = null;
	private tickIntervalHandle: ReturnType<typeof setInterval> | null = null;
	private tick = 0;
	private nextProjectileSeq = 0;
	private matchStartMs: number | null = null;
	private matchEnded = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const matchCode = url.searchParams.get("match");
		if (matchCode && this.matchCode === null) this.matchCode = matchCode;

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		const playerId = crypto.randomUUID();
		this.ctx.acceptWebSocket(server, [playerId]);
		server.serializeAttachment({ playerId });

		// PlayerState creation happens on the `join` message (webSocketMessage), not here — the
		// socket is accepted immediately but the player doesn't exist in sim state until they
		// send their name.

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string") return;

		const { playerId } = (ws.deserializeAttachment() ?? {}) as { playerId?: string };
		if (!playerId) return;

		let parsed: ClientToServerMessage;
		try {
			parsed = JSON.parse(message) as ClientToServerMessage;
		} catch {
			return; // ignore malformed frames rather than crashing the DO
		}

		switch (parsed.type) {
			case "join":
				this.handleJoin(ws, playerId, parsed.name);
				break;
			case "input":
				this.handleInput(playerId, parsed.moveVector, parsed.dashPressed);
				break;
			case "buyWeaponLevel":
				this.handleBuyWeaponLevel(ws, playerId);
				break;
			case "chooseClass":
				this.handleChooseClass(playerId, parsed.weapon);
				break;
		}
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		const { playerId } = (ws.deserializeAttachment() ?? {}) as { playerId?: string };
		if (playerId) {
			this.players.delete(playerId);
			this.playerInternal.delete(playerId);
		}

		this.broadcastState(Date.now());

		if (this.ctx.getWebSockets().length === 0) {
			this.stopTickLoop();
		}
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		await this.webSocketClose(ws);
	}

	// ---- message handlers ----

	private handleJoin(ws: WebSocket, playerId: string, name: string): void {
		if (this.matchEnded || this.players.has(playerId)) return;

		const spawnIndex = this.pickSpawnIndex();
		const player: PlayerState = {
			id: playerId,
			name: name.slice(0, 24) || "Player",
			pos: { ...SPAWN_POINTS[spawnIndex] },
			facing: { x: 1, y: 0 },
			health: MATCH_RULES.maxHealth,
			maxHealth: MATCH_RULES.maxHealth,
			weapon: "shooter",
			weaponLevel: 1,
			money: 0,
			alive: true,
			dashCooldownRemainingMs: 0,
			isDashing: false,
		};
		this.players.set(playerId, player);
		this.playerInternal.set(playerId, {
			lastFiredAtMs: 0,
			dashActiveUntilMs: 0,
			dashReadyAtMs: 0,
			lastInput: { moveVector: { x: 0, y: 0 }, dashPressed: false },
			prevTickDashPressed: false,
			currentTargetId: null,
			losClearSinceMs: null,
			continuousFireMs: 0,
			kills: 0,
			respawnAtMs: null,
			spawnPointIndex: spawnIndex,
		});

		this.send(ws, { type: "joined", playerId, matchCode: this.matchCode ?? "" });
		this.ensureTickLoopStarted();
	}

	private handleInput(playerId: string, moveVector: Vector2, dashPressed: boolean): void {
		const internal = this.playerInternal.get(playerId);
		if (!internal) return;
		internal.lastInput = { moveVector, dashPressed };
	}

	private handleBuyWeaponLevel(ws: WebSocket, playerId: string): void {
		const player = this.players.get(playerId);
		if (!player) return;

		if (!player.alive) return this.send(ws, this.purchaseResult(false, "dead"));
		if (player.weaponLevel >= MAX_WEAPON_LEVEL) {
			return this.send(ws, this.purchaseResult(false, "already at max level"));
		}
		const inShop = SHOP_ZONES.some((zone) => distance(player.pos, zone) <= zone.radius);
		if (!inShop) return this.send(ws, this.purchaseResult(false, "not in a shop zone"));
		if (player.money < ECONOMY.weaponLevelCost) {
			return this.send(ws, this.purchaseResult(false, "insufficient funds"));
		}

		player.money -= ECONOMY.weaponLevelCost;
		player.weaponLevel += 1;
		this.send(ws, this.purchaseResult(true));
	}

	/**
	 * No dedicated ack message exists for chooseClass in the shared protocol (unlike
	 * buyWeaponLevel's `purchaseResult`) — reusing `purchaseResult` for a non-purchase action
	 * would be misleading, and the result is already fully observable via the very next `state`
	 * broadcast's `weapon` field, so no protocol addition was needed here.
	 */
	private handleChooseClass(playerId: string, weapon: WeaponId): void {
		const player = this.players.get(playerId);
		if (!player) return;
		if (weapon === "shooter") return;
		if (player.weapon !== "shooter") return; // one-time choice, already specialized
		if (player.weaponLevel < CLASS_UNLOCK_LEVEL) return;
		player.weapon = weapon;
	}

	private purchaseResult(success: boolean, reason?: string): ServerToClientMessage {
		return { type: "purchaseResult", success, reason };
	}

	private pickSpawnIndex(): number {
		const used = new Set([...this.playerInternal.values()].map((p) => p.spawnPointIndex));
		for (let i = 0; i < SPAWN_POINTS.length; i++) {
			if (!used.has(i)) return i;
		}
		// More players than spawn points — fall back to a random one rather than colliding
		// deterministically on the same slot every time.
		return Math.floor(randomFloat(0, SPAWN_POINTS.length));
	}

	// ---- tick loop ----

	private ensureTickLoopStarted(): void {
		if (this.tickIntervalHandle !== null) return;
		if (this.matchStartMs === null) this.matchStartMs = Date.now();
		this.tickIntervalHandle = setInterval(() => this.runTick(), MATCH_RULES.matchTickMs);
	}

	private stopTickLoop(): void {
		if (this.tickIntervalHandle === null) return;
		clearInterval(this.tickIntervalHandle);
		this.tickIntervalHandle = null;
	}

	private runTick(): void {
		if (this.matchEnded) return;
		const now = Date.now();
		const dt = MATCH_RULES.matchTickMs / 1000;
		this.tick += 1;

		// Pass 1: respawns + movement first, so pass 2's targeting/LOS sees every alive player's
		// current-tick position rather than a mix of updated/stale ones depending on Map
		// iteration order.
		for (const [id, player] of this.players) {
			const internal = this.playerInternal.get(id);
			if (!internal) continue;
			if (!player.alive) {
				if (internal.respawnAtMs !== null && now >= internal.respawnAtMs) {
					this.respawnPlayer(player, internal);
				}
				continue;
			}
			this.updateDash(player, internal, now);
			this.updateMovement(player, internal, dt);
		}

		// Pass 2: targeting, firing, economy, pickups.
		for (const [id, player] of this.players) {
			if (!player.alive) continue;
			const internal = this.playerInternal.get(id);
			if (!internal) continue;
			this.updateTargetingAndFiring(id, player, internal, now, dt);
			player.money += ECONOMY.surviveTickReward; // literal per-tick reward, per shared config's own doc comment
			this.checkPickupCollection(player, now);
		}

		this.advanceProjectiles(dt);
		this.resolveProjectileHits(now);

		this.checkMatchEnd(now);
		if (this.matchEnded) return;

		this.broadcastState(now);
	}

	private updateDash(player: PlayerState, internal: PlayerInternal, now: number): void {
		const { dashPressed } = internal.lastInput;
		const risingEdge = dashPressed && !internal.prevTickDashPressed;
		if (risingEdge && !player.isDashing && now >= internal.dashReadyAtMs) {
			player.isDashing = true;
			internal.dashActiveUntilMs = now + MATCH_RULES.dashDurationMs;
			internal.dashReadyAtMs = now + MATCH_RULES.dashDurationMs + MATCH_RULES.dashCooldownMs;
		}
		if (player.isDashing && now >= internal.dashActiveUntilMs) {
			player.isDashing = false;
		}
		player.dashCooldownRemainingMs = Math.max(0, internal.dashReadyAtMs - now);
		internal.prevTickDashPressed = dashPressed;
	}

	/**
	 * Dash re-evaluates the current joystick vector every tick of its window rather than
	 * locking in a direction at trigger time — dashSpeedMultiplier is a movement multiplier, not
	 * a fixed teleport, so a player holding no direction while pressing dash simply doesn't move
	 * (client UX is expected to have the player hold a direction to get anywhere from a dash).
	 */
	private updateMovement(player: PlayerState, internal: PlayerInternal, dt: number): void {
		const move = internal.lastInput.moveVector;
		const magnitude = Math.min(1, length(move));
		const dir = magnitude > 1e-6 ? normalize(move) : { x: 0, y: 0 };
		const speedMultiplier = player.isDashing ? MATCH_RULES.dashSpeedMultiplier : 1;
		const speed = MATCH_RULES.moveSpeed * magnitude * speedMultiplier;
		const desired = add(player.pos, scale(dir, speed * dt));
		player.pos = resolveMovement(player.pos, desired, PLAYER_HITBOX_RADIUS, OBSTACLES);
	}

	/**
	 * Auto-target acquisition + firing + facing.
	 *
	 * LOS-reacquire simplification: LOS is only evaluated once per tick (100ms), not
	 * continuously, so "continuously clear" is tracked at tick granularity — a break/clear that
	 * both happen strictly between two ticks would be missed. Given losReacquireMs (150ms) is on
	 * the same order as matchTickMs (100ms), this is an acceptable approximation rather than a
	 * fully precise sub-tick raycast history.
	 */
	private updateTargetingAndFiring(
		id: string,
		player: PlayerState,
		internal: PlayerInternal,
		now: number,
		dt: number,
	): void {
		const weapon = WEAPONS[player.weapon];
		const candidate = this.findNearestValidTarget(id, player, weapon);

		if (candidate) {
			if (internal.currentTargetId !== candidate.id || internal.losClearSinceMs === null) {
				// Newly acquired target (previous one died/left, or a nearer one appeared), or LOS to
				// the same target just became clear again after a break — reacquire timer (re)starts.
				internal.losClearSinceMs = now;
			}
			internal.currentTargetId = candidate.id;
		} else {
			internal.currentTargetId = null;
			internal.losClearSinceMs = null;
		}

		const locked =
			candidate !== null &&
			internal.losClearSinceMs !== null &&
			now - internal.losClearSinceMs >= weapon.losReacquireMs;

		if (candidate) {
			const desiredFacing = normalize(sub(candidate.pos, player.pos));
			player.facing = this.turnFacing(player.facing, weapon, desiredFacing, locked, dt);
		} else if (length(internal.lastInput.moveVector) > 1e-6) {
			player.facing = normalize(internal.lastInput.moveVector);
		}

		if (!locked) {
			internal.continuousFireMs = 0;
			return;
		}

		internal.continuousFireMs += dt * 1000;
		const cooldown = effectiveCooldownMs(weapon, player.weaponLevel, internal.continuousFireMs);
		if (now - internal.lastFiredAtMs >= cooldown) {
			this.fireProjectile(id, player, internal, weapon);
			internal.lastFiredAtMs = now;
		}
	}

	private findNearestValidTarget(
		id: string,
		player: PlayerState,
		weapon: WeaponStats,
	): PlayerState | null {
		let best: PlayerState | null = null;
		let bestDist = Infinity;
		for (const [otherId, other] of this.players) {
			if (otherId === id || !other.alive) continue;
			const d = distance(player.pos, other.pos);
			if (d > weapon.range) continue;
			if (!hasLineOfSight(player.pos, other.pos)) continue;
			if (d < bestDist) {
				bestDist = d;
				best = other;
			}
		}
		return best;
	}

	/**
	 * Turn `current` facing toward `desired`, instantly except for a minigun actively engaged
	 * with a locked target (trackingPenaltyWhileFiring) — every other case snaps instantly since
	 * there's no manual-aim skill to model. Limiting the minigun's turn rate means its aim
	 * visibly lags behind a target that dodges diagonally, which is the actual mechanic the
	 * design doc describes ("dodge diagonally — it can't track").
	 */
	private turnFacing(
		current: Vector2,
		weapon: WeaponStats,
		desired: Vector2,
		firing: boolean,
		dt: number,
	): Vector2 {
		const penalty = weapon.trackingPenaltyWhileFiring;
		if (!firing || penalty === undefined) return desired;

		const maxTurnDeg = MINIGUN_BASE_TURN_RATE_DEG_PER_SEC * (1 - penalty) * dt;
		const diff = wrapAngleDeg(angleOfDeg(desired) - angleOfDeg(current));
		const clampedDiff = Math.max(-maxTurnDeg, Math.min(maxTurnDeg, diff));
		const newAngleRad = ((angleOfDeg(current) + clampedDiff) * Math.PI) / 180;
		return { x: Math.cos(newAngleRad), y: Math.sin(newAngleRad) };
	}

	private fireProjectile(
		ownerId: string,
		player: PlayerState,
		internal: PlayerInternal,
		weapon: WeaponStats,
	): void {
		const baseDamage = damageAtLevel(weapon, player.weaponLevel);
		const spreadDeg = effectiveSpreadDegrees(weapon, internal.continuousFireMs);
		const aimDir = rotate(player.facing, randomSymmetric(spreadDeg));

		const id = `proj-${ownerId}-${this.nextProjectileSeq++}`;
		this.projectiles.set(id, {
			id,
			ownerId,
			pos: { ...player.pos },
			velocity: scale(aimDir, weapon.projectileSpeed),
			weapon: weapon.id,
		});
		this.projectileInternal.set(id, {
			ownerId,
			weapon: weapon.id,
			spawnPos: { ...player.pos },
			baseDamage,
		});
	}

	private advanceProjectiles(dt: number): void {
		for (const [id, proj] of this.projectiles) {
			proj.pos = add(proj.pos, scale(proj.velocity, dt));

			const internal = this.projectileInternal.get(id);
			if (!internal) continue;
			const weapon = WEAPONS[proj.weapon];
			const traveled = distance(proj.pos, internal.spawnPos);
			const outOfRange = traveled > weapon.range;
			const outOfArena =
				proj.pos.x < 0 || proj.pos.x > ARENA.width || proj.pos.y < 0 || proj.pos.y > ARENA.height;

			if (outOfRange || outOfArena) {
				this.projectiles.delete(id);
				this.projectileInternal.delete(id);
			}
		}
	}

	private resolveProjectileHits(now: number): void {
		for (const [id, proj] of this.projectiles) {
			const internal = this.projectileInternal.get(id);
			if (!internal) continue;

			for (const [pid, target] of this.players) {
				if (pid === proj.ownerId || !target.alive) continue;
				if (distance(proj.pos, target.pos) > PLAYER_HITBOX_RADIUS) continue;

				const weapon = WEAPONS[proj.weapon];
				const traveled = distance(proj.pos, internal.spawnPos);
				const dmg = applyDamageFalloff(weapon, internal.baseDamage, traveled);
				target.health = Math.max(0, target.health - dmg);

				this.projectiles.delete(id);
				this.projectileInternal.delete(id);

				if (target.health <= 0) this.handleDeath(pid, target, proj.ownerId, now);
				break; // projectile consumed — stop checking other players
			}
		}
	}

	private handleDeath(victimId: string, victim: PlayerState, killerId: string, now: number): void {
		victim.alive = false;
		victim.health = 0;
		const newLevel = decayLevelOnDeath(victim.weaponLevel);
		victim.weaponLevel = newLevel;

		const victimInternal = this.playerInternal.get(victimId);
		if (victimInternal) victimInternal.respawnAtMs = now + RESPAWN_DELAY_MS;

		const killer = killerId !== victimId ? this.players.get(killerId) : undefined;
		if (killer) {
			killer.money += ECONOMY.killReward;
			const killerInternal = this.playerInternal.get(killerId);
			if (killerInternal) killerInternal.kills += 1;
		}

		this.broadcast({
			type: "death",
			playerId: victimId,
			killerId: killer ? killerId : null,
			newLevel,
		});
	}

	private respawnPlayer(player: PlayerState, internal: PlayerInternal): void {
		const spawnIndex = this.pickSpawnIndex();
		internal.spawnPointIndex = spawnIndex;
		internal.respawnAtMs = null;
		internal.currentTargetId = null;
		internal.losClearSinceMs = null;
		internal.continuousFireMs = 0;
		internal.lastFiredAtMs = 0;

		player.pos = { ...SPAWN_POINTS[spawnIndex] };
		player.health = MATCH_RULES.maxHealth;
		player.alive = true;
	}

	private checkPickupCollection(player: PlayerState, now: number): void {
		for (const pickup of this.pickups) {
			if (pickup.respawnAtMs !== null) {
				if (now >= pickup.respawnAtMs) pickup.respawnAtMs = null;
				else continue;
			}
			if (distance(player.pos, pickup.pos) <= PICKUP_COLLECT_RADIUS) {
				player.money += pickup.value;
				pickup.respawnAtMs = now + PICKUP_RESPAWN_MS;
			}
		}
	}

	private checkMatchEnd(now: number): void {
		if (this.matchEnded || this.matchStartMs === null) return;

		let winnerByKills: string | null = null;
		for (const [id, internal] of this.playerInternal) {
			if (internal.kills >= MATCH_RULES.killsToWin) {
				winnerByKills = id;
				break;
			}
		}
		const timerExpired = now - this.matchStartMs >= MATCH_RULES.matchDurationMs;
		if (!winnerByKills && !timerExpired) return;

		this.matchEnded = true;
		this.stopTickLoop();

		let winnerId = winnerByKills;
		const reason: "kills" | "timer" = winnerByKills ? "kills" : "timer";

		if (!winnerId && timerExpired) {
			// Tiebreak on timer expiry: whoever has the most kills wins; a genuine tie (or nobody
			// having scored at all) is null, per spec ("null on a timer-expiry tie").
			let topKills = -1;
			let tied = false;
			for (const [id, internal] of this.playerInternal) {
				if (internal.kills > topKills) {
					topKills = internal.kills;
					winnerId = id;
					tied = false;
				} else if (internal.kills === topKills) {
					tied = true;
				}
			}
			if (tied || topKills <= 0) winnerId = null;
		}

		this.broadcast({ type: "matchEnd", winnerId, reason });
	}

	private broadcastState(now: number): void {
		this.broadcast({
			type: "state",
			tick: this.tick,
			serverTimeMs: now,
			players: [...this.players.values()],
			projectiles: [...this.projectiles.values()],
			pickups: this.pickups
				.filter((p) => p.respawnAtMs === null)
				.map((p) => ({ id: p.id, pos: p.pos, value: p.value })),
			shopZones: SHOP_ZONES.map((z, i) => ({ id: `shop-${i}`, pos: { x: z.x, y: z.y }, radius: z.radius })),
		});
	}

	private send(ws: WebSocket, message: ServerToClientMessage): void {
		ws.send(JSON.stringify(message));
	}

	private broadcast(message: ServerToClientMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			ws.send(payload);
		}
	}
}
