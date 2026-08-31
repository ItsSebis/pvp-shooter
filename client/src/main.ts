import Phaser from "phaser";
import { connectToMatch, resolveMatchCode, send } from "./net/socket";

/**
 * TODO(client): this is scaffold only — a booting Phaser game + a live WebSocket connection.
 * The real work (see docs/GAME_DESIGN.md + "client" module boundary in docs/ARCHITECTURE.md):
 *   - Phaser scene(s): map with LOS-breaking obstacles, player sprites, projectile rendering
 *   - Virtual joystick (phaser3-rex-plugins) for movement + a dash button, sending `input`
 *     messages (see shared/protocol.ts) at a reasonable rate, not every frame
 *   - HUD (health, money, weapon/level, dash cooldown) driven by `state` messages
 *   - Shop UI triggered by walking into a ShopZoneState, sending `buyWeaponLevel`
 *   - Class selection UI once a player's weaponLevel/kills reach CLASS_UNLOCK_LEVEL
 *   - Read all weapon/leveling numbers from shared/game-config.ts — never hardcode them
 */

class BootScene extends Phaser.Scene {
	create() {
		const matchCode = resolveMatchCode();
		const status = this.add
			.text(16, 16, `Connecting to match ${matchCode}...`, {
				fontFamily: "monospace",
				fontSize: "16px",
				color: "#e6e6e6",
			})
			.setScrollFactor(0);

		const ws = connectToMatch(matchCode, (message) => {
			if (message.type === "joined") {
				status.setText(`Joined match ${message.matchCode} as ${message.playerId}`);
			}
			// TODO(client): dispatch `state` / `death` / `matchEnd` / `purchaseResult` into the
			// active scene once the real game scene exists.
		});

		ws.addEventListener("open", () => {
			send(ws, { type: "join", name: "Player" });
		});
	}
}

new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: "#0b0b12",
	scale: {
		mode: Phaser.Scale.RESIZE,
		width: window.innerWidth,
		height: window.innerHeight,
	},
	scene: [BootScene],
});
