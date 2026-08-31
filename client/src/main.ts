import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

/**
 * Boots the Phaser game inside the pwa-owned `#game` mount (see client/index.html). All actual
 * gameplay — map rendering, joystick/dash input, HUD, shop UI, class selection, death/match-end
 * overlays — lives in GameScene and the modules it composes (client/src/net, client/src/input,
 * client/src/render, client/src/ui).
 *
 * Scale.RESIZE keeps the canvas matched to the viewport (mobile-first, orientation can change at
 * runtime); GameScene compensates by zooming/centering its camera on the fixed-size arena rather
 * than relying on the canvas's raw pixel size for gameplay coordinates.
 */
new Phaser.Game({
	type: Phaser.AUTO,
	parent: "game",
	backgroundColor: "#0b0b12",
	scale: {
		mode: Phaser.Scale.RESIZE,
		width: window.innerWidth,
		height: window.innerHeight,
	},
	scene: [GameScene],
});
