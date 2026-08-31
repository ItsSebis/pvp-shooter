import Phaser from "phaser";
// Direct class import rather than going through Phaser's PluginManager/scene-mapping ceremony —
// `VirtualJoyStickPlugin.add(scene, config)` (see node_modules/phaser3-rex-plugins/plugins/
// virtualjoystick-plugin.js) is a one-line wrapper around `new VirtualJoyStick(scene, config)`,
// and instantiating it directly keeps this file fully typed without a TS module-augmentation hack.
import VirtualJoyStick from "phaser3-rex-plugins/plugins/virtualjoystick.js";
import type { Vector2 } from "../../../shared/protocol";
import { MATCH_RULES } from "../../../shared/game-config";

const JOYSTICK_RADIUS = 70;
const JOYSTICK_DEADZONE = 0.08;
const DASH_BUTTON_RADIUS = 46;
const MARGIN = 110;
const UI_DEPTH = 1000;

/**
 * Left-thumb virtual joystick (movement only, via phaser3-rex-plugins) + right-thumb dash
 * button. Both are fixed to the camera (scroll factor 0) and repositioned on resize so they
 * stay in their thumb zones regardless of viewport size/orientation.
 */
export class TouchControls {
	private readonly scene: Phaser.Scene;
	private readonly joystick: VirtualJoyStick;
	private readonly joystickBase: Phaser.GameObjects.Arc;
	private readonly joystickThumb: Phaser.GameObjects.Arc;
	private readonly dashButton: Phaser.GameObjects.Arc;
	private readonly dashLabel: Phaser.GameObjects.Text;
	private readonly dashCooldownRing: Phaser.GameObjects.Graphics;
	private dashOnCooldown = false;

	constructor(scene: Phaser.Scene, onDashPress: () => void) {
		this.scene = scene;
		const { width, height } = scene.scale.gameSize;

		const base = scene.add.circle(0, 0, JOYSTICK_RADIUS, 0xffffff, 0.12).setStrokeStyle(2, 0xffffff, 0.35);
		const thumb = scene.add.circle(0, 0, 32, 0xffffff, 0.3);
		base.setDepth(UI_DEPTH);
		thumb.setDepth(UI_DEPTH);
		this.joystickBase = base;
		this.joystickThumb = thumb;
		this.joystick = new VirtualJoyStick(scene, {
			x: MARGIN,
			y: height - MARGIN,
			radius: JOYSTICK_RADIUS,
			base,
			thumb,
		});

		this.dashButton = scene.add
			.circle(width - MARGIN, height - MARGIN, DASH_BUTTON_RADIUS, 0x4fd1ff, 0.45)
			.setScrollFactor(0)
			.setDepth(UI_DEPTH)
			.setInteractive({ useHandCursor: false });
		this.dashLabel = scene.add
			.text(width - MARGIN, height - MARGIN, "DASH", {
				fontFamily: "sans-serif",
				fontSize: "14px",
				color: "#0b0b12",
				fontStyle: "bold",
			})
			.setOrigin(0.5)
			.setScrollFactor(0)
			.setDepth(UI_DEPTH + 1);
		this.dashCooldownRing = scene.add.graphics().setScrollFactor(0).setDepth(UI_DEPTH + 1);

		this.dashButton.on("pointerdown", () => {
			if (!this.dashOnCooldown) onDashPress();
		});

		scene.scale.on(Phaser.Scale.Events.RESIZE, (gameSize: Phaser.Structs.Size) => this.layout(gameSize));
	}

	/** Screen-space display objects — rendered only by the unzoomed UI camera (see GameScene),
	 * so these stay pinned to the true screen corners regardless of the main camera's zoom
	 * (which letterboxes the arena to fit the viewport and would otherwise scale/shift these
	 * out of their thumb-reachable positions). */
	get displayObjects(): Phaser.GameObjects.GameObject[] {
		return [this.joystickBase, this.joystickThumb, this.dashButton, this.dashLabel, this.dashCooldownRing];
	}

	private layout(gameSize: { width: number; height: number }): void {
		this.joystick.setPosition(MARGIN, gameSize.height - MARGIN);
		this.dashButton.setPosition(gameSize.width - MARGIN, gameSize.height - MARGIN);
		this.dashLabel.setPosition(gameSize.width - MARGIN, gameSize.height - MARGIN);
	}

	/** Normalized (magnitude 0..1) movement vector for the current frame, per the `input` protocol. */
	getMoveVector(): Vector2 {
		if (this.joystick.force < JOYSTICK_RADIUS * JOYSTICK_DEADZONE) return { x: 0, y: 0 };
		const magnitude = Math.min(this.joystick.force / JOYSTICK_RADIUS, 1);
		const angle = this.joystick.rotation;
		return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
	}

	/** Render the dash cooldown as a dimmed button + a radial wipe ring, from server-authoritative state. */
	updateDashCooldown(dashCooldownRemainingMs: number): void {
		this.dashOnCooldown = dashCooldownRemainingMs > 0;
		this.dashButton.setFillStyle(0x4fd1ff, this.dashOnCooldown ? 0.18 : 0.5);

		this.dashCooldownRing.clear();
		if (this.dashOnCooldown) {
			const ratio = Phaser.Math.Clamp(dashCooldownRemainingMs / MATCH_RULES.dashCooldownMs, 0, 1);
			this.dashCooldownRing.lineStyle(4, 0xffffff, 0.85);
			this.dashCooldownRing.beginPath();
			this.dashCooldownRing.arc(
				this.dashButton.x,
				this.dashButton.y,
				DASH_BUTTON_RADIUS + 6,
				-Math.PI / 2,
				-Math.PI / 2 + ratio * Math.PI * 2,
				false,
			);
			this.dashCooldownRing.strokePath();
		}
	}
}
