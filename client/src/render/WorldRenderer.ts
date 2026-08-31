import Phaser from "phaser";
import { ARENA, OBSTACLES } from "../../../shared/map";
import type { MoneyPickupState, PlayerState, ProjectileState, ShopZoneState } from "../../../shared/protocol";
import type { WeaponId } from "../../../shared/game-config";

const PLAYER_RADIUS = 16;
const FACING_LENGTH = 26;
const PROJECTILE_RADIUS = 4;
const PICKUP_RADIUS = 5;
const HEALTH_BAR_WIDTH = 32;
const HEALTH_BAR_HEIGHT = 4;

const WEAPON_COLOR: Record<WeaponId, number> = {
	shooter: 0xe6e6e6,
	sniper: 0x4fd1ff,
	shotgun: 0xffa64f,
	minigun: 0xff4f4f,
};

// Stable per-player color assignment (first-seen order), independent of weapon, so a player's
// dot color doesn't jump the moment they choose a class — the small facing-direction wedge and
// the weapon-colored projectiles they fire are what communicate weapon choice instead.
const PLAYER_PALETTE = [0x59d18a, 0xf2c14e, 0xef6f6c, 0x8aa8ff, 0xc879ff, 0x5fe0d0];

export class WorldRenderer {
	private readonly dynamicLayer: Phaser.GameObjects.Graphics;
	private readonly playerColors = new Map<string, number>();

	constructor(scene: Phaser.Scene) {
		this.drawStaticMap(scene);
		this.dynamicLayer = scene.add.graphics();
	}

	private drawStaticMap(scene: Phaser.Scene): void {
		const g = scene.add.graphics();
		g.fillStyle(0x14141c, 1);
		g.fillRect(0, 0, ARENA.width, ARENA.height);
		g.lineStyle(2, 0x2a2a38, 1);
		g.strokeRect(0, 0, ARENA.width, ARENA.height);

		g.fillStyle(0x555560, 1);
		g.lineStyle(2, 0x717180, 1);
		for (const obstacle of OBSTACLES) {
			g.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
			g.strokeRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
		}
	}

	private colorFor(playerId: string): number {
		let color = this.playerColors.get(playerId);
		if (color === undefined) {
			color = PLAYER_PALETTE[this.playerColors.size % PLAYER_PALETTE.length];
			this.playerColors.set(playerId, color);
		}
		return color;
	}

	render(
		players: PlayerState[],
		projectiles: ProjectileState[],
		pickups: MoneyPickupState[],
		shopZones: ShopZoneState[],
		localPlayerId: string | null,
	): void {
		const g = this.dynamicLayer;
		g.clear();

		for (const zone of shopZones) {
			const inRange = localPlayerId
				? isWithinShopZone(players.find((p) => p.id === localPlayerId), zone)
				: false;
			g.lineStyle(3, 0xb14fff, inRange ? 1 : 0.55);
			g.strokeCircle(zone.pos.x, zone.pos.y, zone.radius);
			g.fillStyle(0xb14fff, inRange ? 0.18 : 0.08);
			g.fillCircle(zone.pos.x, zone.pos.y, zone.radius);
		}

		for (const pickup of pickups) {
			g.fillStyle(0xffe14f, 1);
			g.fillCircle(pickup.pos.x, pickup.pos.y, PICKUP_RADIUS);
		}

		for (const projectile of projectiles) {
			g.fillStyle(WEAPON_COLOR[projectile.weapon], 1);
			g.fillCircle(projectile.pos.x, projectile.pos.y, PROJECTILE_RADIUS);
		}

		for (const player of players) {
			if (!player.alive) continue;
			const color = this.colorFor(player.id);
			const isLocal = player.id === localPlayerId;

			g.fillStyle(color, 1);
			g.fillCircle(player.pos.x, player.pos.y, PLAYER_RADIUS);
			g.lineStyle(isLocal ? 3 : 2, isLocal ? 0xffffff : 0x0b0b12, isLocal ? 1 : 0.8);
			g.strokeCircle(player.pos.x, player.pos.y, PLAYER_RADIUS);

			// Facing indicator: small wedge pointing along `facing` so the (server-computed,
			// auto-aim) direction the player is about to shoot is visible without a manual aim UI.
			const tipX = player.pos.x + player.facing.x * FACING_LENGTH;
			const tipY = player.pos.y + player.facing.y * FACING_LENGTH;
			g.lineStyle(3, 0xffffff, 0.9);
			g.beginPath();
			g.moveTo(player.pos.x, player.pos.y);
			g.lineTo(tipX, tipY);
			g.strokePath();

			// Overhead health bar so remote players' health is readable too (the HUD only covers
			// the local player).
			const barX = player.pos.x - HEALTH_BAR_WIDTH / 2;
			const barY = player.pos.y - PLAYER_RADIUS - 12;
			g.fillStyle(0x000000, 0.5);
			g.fillRect(barX, barY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
			const healthRatio = Phaser.Math.Clamp(player.health / player.maxHealth, 0, 1);
			g.fillStyle(healthRatio > 0.3 ? 0x59d18a : 0xef6f6c, 1);
			g.fillRect(barX, barY, HEALTH_BAR_WIDTH * healthRatio, HEALTH_BAR_HEIGHT);
		}
	}
}

export function isWithinShopZone(player: PlayerState | undefined, zone: ShopZoneState): boolean {
	if (!player || !player.alive) return false;
	const dx = player.pos.x - zone.pos.x;
	const dy = player.pos.y - zone.pos.y;
	return dx * dx + dy * dy <= zone.radius * zone.radius;
}
