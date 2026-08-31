import Phaser from "phaser";
import { ARENA } from "../../../shared/map";
import { MATCH_RULES } from "../../../shared/game-config";
import type { ServerToClientMessage, Vector2 } from "../../../shared/protocol";
import { NetworkManager } from "../net/NetworkManager";
import { TouchControls } from "../input/TouchControls";
import { WorldRenderer } from "../render/WorldRenderer";
import { interpolateSnapshots } from "../render/interpolate";
import { UIOverlay } from "../ui/UIOverlay";

type StateMessage = Extract<ServerToClientMessage, { type: "state" }>;

/** Throttle for outgoing `input` messages — frequent enough to feel responsive, far below
 * per-frame (60/s) to keep the WebSocket light, per the task brief's 50-100ms guidance. */
const INPUT_SEND_INTERVAL_MS = 75;

/** Render slightly behind the latest snapshot so there's always a newer one to interpolate
 * remote players/projectiles toward — one server tick is enough to smooth without feeling stale. */
const RENDER_DELAY_MS = 100;
/** Local-player prediction: drift beyond this snaps instantly to the server's position (a real
 * desync — obstacle collision, respawn, a rejected dash); anything smaller eases out over a few
 * frames via LOCAL_CORRECTION_EASE so a correction never reads as a visible snap. */
const LOCAL_CORRECTION_SNAP_PX = 80;
const LOCAL_CORRECTION_EASE = 0.15;

export class GameScene extends Phaser.Scene {
	private net!: NetworkManager;
	private world!: WorldRenderer;
	private touch!: TouchControls;
	private ui!: UIOverlay;
	private uiCamera!: Phaser.Cameras.Scene2D.Camera;

	private latestState: StateMessage | null = null;
	private sendAccumulatorMs = 0;

	/** Buffered `state` snapshots (most recent last), used to interpolate remote entities. */
	private snapshots: StateMessage[] = [];
	/** Client-predicted position for the local player only — advanced every frame from raw input
	 * rather than waiting for the next server broadcast, then eased toward the server's actual
	 * position as it arrives. Remote players/projectiles use snapshot interpolation instead (see
	 * renderFrame); a local follow-camera-of-one doesn't need — and shouldn't have — the same
	 * render-delay smoothing, since that would make your own movement feel laggy under your own
	 * thumb, which is the exact complaint this exists to fix. */
	private predictedLocalPos: Vector2 | null = null;
	private localDashActiveUntilMs = 0;

	constructor() {
		super("GameScene");
	}

	create(): void {
		this.cameras.main.setBounds(0, 0, ARENA.width, ARENA.height);
		this.fitCameraToArena();

		// A second, unzoomed camera for touch controls. The main camera zooms out to letterbox
		// the arena to fit the viewport (see fitCameraToArena) — `setScrollFactor(0)` alone only
		// cancels scroll, not zoom, so screen-fixed objects on the main camera would still be
		// scaled/shifted into the letterboxed region instead of staying pinned to the real screen
		// corners. Each camera renders only its own layer via `ignore()` below so nothing draws
		// twice.
		this.uiCamera = this.cameras.add(0, 0, this.scale.gameSize.width, this.scale.gameSize.height);
		this.uiCamera.setScroll(0, 0).setZoom(1);

		this.world = new WorldRenderer(this);
		this.touch = new TouchControls(this, () => this.triggerDash());
		this.net = new NetworkManager();
		this.ui = new UIOverlay(this.net);

		this.uiCamera.ignore(this.world.displayObjects);
		this.cameras.main.ignore(this.touch.displayObjects);

		this.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => {
			this.fitCameraToArena();
			this.uiCamera.setSize(gameSize.width, gameSize.height);
		});

		this.net.on("state", (msg) => this.onState(msg));
		this.net.on("death", (msg) => this.onDeath(msg));
		this.net.on("matchEnd", (msg) => {
			const winnerName = this.latestState?.players.find((p) => p.id === msg.winnerId)?.name ?? null;
			this.ui.showMatchEnd(msg, winnerName);
		});
		this.net.on("purchaseResult", (msg) => this.ui.flashPurchaseResult(msg));
		this.net.on("error", (msg) => this.ui.showError(msg.message));

		// Prime the HUD with defaults before the first `state` message arrives.
		this.ui.updateHud(null);
	}

	update(_time: number, delta: number): void {
		this.sendAccumulatorMs += delta;
		if (this.sendAccumulatorMs >= INPUT_SEND_INTERVAL_MS) {
			this.sendAccumulatorMs = 0;
			this.net.sendInput(this.touch.getMoveVector(), false);
		}

		this.advanceLocalPrediction(delta);
		this.renderFrame();
	}

	/** Advances the local player's predicted position every rendered frame using the same
	 * movement formula the server applies server-side (see server/match-room.ts's `resolveMovement`
	 * call), then eases it toward the last known server-authoritative position. This is what makes
	 * your own movement feel immediate instead of waiting up to a full tick (100ms) plus network
	 * round-trip for the server to confirm it — the server remains authoritative, this is a visual
	 * prediction only. Doesn't simulate obstacle collision client-side (the server does); walking
	 * into a wall shows a brief, small correction rather than a hard stop, which is an acceptable
	 * trade for not duplicating collision logic on both sides. */
	private advanceLocalPrediction(deltaMs: number): void {
		if (!this.predictedLocalPos) return;
		const dt = deltaMs / 1000;
		const move = this.touch.getMoveVector(); // already direction * magnitude(0..1)
		const dashActive = Date.now() < this.localDashActiveUntilMs;
		const speedScale = MATCH_RULES.moveSpeed * (dashActive ? MATCH_RULES.dashSpeedMultiplier : 1);
		this.predictedLocalPos.x += move.x * speedScale * dt;
		this.predictedLocalPos.y += move.y * speedScale * dt;

		const serverLocal = this.latestState?.players.find((p) => p.id === this.net.playerId);
		if (serverLocal) {
			this.predictedLocalPos.x += (serverLocal.pos.x - this.predictedLocalPos.x) * LOCAL_CORRECTION_EASE;
			this.predictedLocalPos.y += (serverLocal.pos.y - this.predictedLocalPos.y) * LOCAL_CORRECTION_EASE;
		}
	}

	/** Renders every frame (not just on `state` receipt): interpolates remote players/projectiles
	 * between buffered snapshots at RENDER_DELAY_MS behind the latest one, then overrides the local
	 * player's position with the prediction from advanceLocalPrediction so it's never delayed. */
	private renderFrame(): void {
		const latest = this.snapshots[this.snapshots.length - 1];
		if (!latest) return;

		const renderTimeMs = latest.serverTimeMs - RENDER_DELAY_MS;
		const { players, projectiles } = interpolateSnapshots(this.snapshots, renderTimeMs);

		const localId = this.net.playerId;
		const displayPlayers = this.predictedLocalPos
			? players.map((p) => (p.id === localId ? { ...p, pos: this.predictedLocalPos! } : p))
			: players;

		this.world.render(displayPlayers, projectiles, latest.pickups, latest.shopZones, localId);
	}

	/**
	 * The arena is small enough (1600x900) and the game has no manual aim, so rather than a
	 * per-player follow camera, the whole map is always fully visible (letterboxed to fit the
	 * viewport) — positioning/LOS reads are the core skill, which requires seeing the full map.
	 */
	private fitCameraToArena(): void {
		const { width, height } = this.scale.gameSize;
		const zoom = Math.min(width / ARENA.width, height / ARENA.height);
		this.cameras.main.setZoom(zoom);
		this.cameras.main.centerOn(ARENA.width / 2, ARENA.height / 2);
	}

	/** Dash is edge-triggered: fire immediately on press rather than waiting for the input
	 * throttle window, and reset the throttle so the next throttled send doesn't redundantly
	 * resend `dashPressed: true` a moment later. */
	private triggerDash(): void {
		this.net.sendInput(this.touch.getMoveVector(), true);
		this.sendAccumulatorMs = 0;
		// Predict the dash burst locally too (TouchControls already blocks pressing while on
		// cooldown, so a server-side rejection here is rare — and self-corrects within a few
		// frames via the continuous easing in advanceLocalPrediction if it does happen).
		this.localDashActiveUntilMs = Date.now() + MATCH_RULES.dashDurationMs;
	}

	private onState(msg: StateMessage): void {
		this.latestState = msg;
		this.snapshots.push(msg);
		if (this.snapshots.length > 5) this.snapshots.shift();

		const localPlayer = msg.players.find((p) => p.id === this.net.playerId) ?? null;
		if (localPlayer) {
			if (!this.predictedLocalPos) {
				this.predictedLocalPos = { ...localPlayer.pos };
			} else {
				const dx = localPlayer.pos.x - this.predictedLocalPos.x;
				const dy = localPlayer.pos.y - this.predictedLocalPos.y;
				if (Math.hypot(dx, dy) > LOCAL_CORRECTION_SNAP_PX) {
					// A real desync (respawn, a rejected dash, etc.) rather than the small, expected
					// drift from not simulating obstacle collision client-side — snap instantly.
					this.predictedLocalPos = { ...localPlayer.pos };
				}
			}
		}

		this.ui.updateHud(localPlayer);
		this.ui.updateShopPrompt(localPlayer, msg.shopZones);
		this.ui.updateClassSelect(localPlayer);
		this.touch.updateDashCooldown(localPlayer?.dashCooldownRemainingMs ?? 0);
	}

	private onDeath(msg: Extract<ServerToClientMessage, { type: "death" }>): void {
		if (msg.playerId !== this.net.playerId) return;
		const killerName = msg.killerId
			? this.latestState?.players.find((p) => p.id === msg.killerId)?.name ?? msg.killerId
			: null;
		this.ui.showDeathOverlay(msg, killerName);
	}
}
