import Phaser from "phaser";
import { ARENA } from "../../../shared/map";
import type { ServerToClientMessage } from "../../../shared/protocol";
import { NetworkManager } from "../net/NetworkManager";
import { TouchControls } from "../input/TouchControls";
import { WorldRenderer } from "../render/WorldRenderer";
import { UIOverlay } from "../ui/UIOverlay";

type StateMessage = Extract<ServerToClientMessage, { type: "state" }>;

/** Throttle for outgoing `input` messages — frequent enough to feel responsive, far below
 * per-frame (60/s) to keep the WebSocket light, per the task brief's 50-100ms guidance. */
const INPUT_SEND_INTERVAL_MS = 75;

export class GameScene extends Phaser.Scene {
	private net!: NetworkManager;
	private world!: WorldRenderer;
	private touch!: TouchControls;
	private ui!: UIOverlay;

	private latestState: StateMessage | null = null;
	private sendAccumulatorMs = 0;

	constructor() {
		super("GameScene");
	}

	create(): void {
		this.cameras.main.setBounds(0, 0, ARENA.width, ARENA.height);
		this.fitCameraToArena();
		this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCameraToArena());

		this.world = new WorldRenderer(this);
		this.touch = new TouchControls(this, () => this.triggerDash());
		this.net = new NetworkManager();
		this.ui = new UIOverlay(this.net);

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
	}

	private onState(msg: StateMessage): void {
		this.latestState = msg;
		const localPlayer = msg.players.find((p) => p.id === this.net.playerId) ?? null;

		this.world.render(msg.players, msg.projectiles, msg.pickups, msg.shopZones, this.net.playerId);
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
