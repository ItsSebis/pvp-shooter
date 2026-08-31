import type { PlayerState, ServerToClientMessage, ShopZoneState } from "../../../shared/protocol";
import {
	CLASS_UNLOCK_LEVEL,
	MATCH_RULES,
	MAX_WEAPON_LEVEL,
	weaponLevelCost,
	WEAPONS,
	type WeaponId,
} from "../../../shared/game-config";
import { isWithinShopZone } from "../render/WorldRenderer";
import type { NetworkManager } from "../net/NetworkManager";

type DeathMessage = Extract<ServerToClientMessage, { type: "death" }>;
type MatchEndMessage = Extract<ServerToClientMessage, { type: "matchEnd" }>;
type PurchaseResultMessage = Extract<ServerToClientMessage, { type: "purchaseResult" }>;

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

const STYLE = `
#ui-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 20; font-family: sans-serif; color: #f2f2f5; }
#ui-overlay button { pointer-events: auto; font-family: inherit; cursor: pointer; }

.hud-panel { position: absolute; top: 10px; left: 10px; display: flex; flex-direction: column; gap: 4px;
	background: rgba(10,10,16,0.55); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
	padding: 8px 12px; font-size: 13px; min-width: 150px; }
.hud-row { display: flex; align-items: center; gap: 6px; }
.hud-bar-track { flex: 1; height: 10px; background: rgba(255,255,255,0.12); border-radius: 5px; overflow: hidden; }
.hud-bar-fill { height: 100%; background: #59d18a; transition: width 0.15s linear; }
.hud-bar-fill.dash { background: #4fd1ff; }
.hud-label { width: 44px; opacity: 0.75; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }

.panel-center { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%);
	background: rgba(10,10,16,0.72); border: 1px solid rgba(177,79,255,0.6); border-radius: 10px;
	padding: 10px 16px; text-align: center; font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
.panel-center button { background: #b14fff; border: none; color: #0b0b12; font-weight: 700; padding: 6px 14px;
	border-radius: 6px; font-size: 13px; }
.panel-center button:disabled { opacity: 0.4; cursor: default; }

.class-select { position: absolute; left: 50%; top: 14px; transform: translateX(-50%);
	display: flex; gap: 8px; background: rgba(10,10,16,0.72); border: 1px solid rgba(255,255,255,0.2);
	border-radius: 10px; padding: 8px 10px; }
.class-select button { background: #23232f; border: 1px solid rgba(255,255,255,0.25); color: #f2f2f5;
	padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.class-select button:hover { background: #33334a; }

.invite-panel { position: absolute; top: 10px; right: 10px; max-width: min(46vw, 220px);
	display: flex; align-items: center; gap: 6px;
	background: rgba(10,10,16,0.55); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
	padding: 6px 8px; font-size: 12px; }
.invite-panel span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.invite-panel button { flex-shrink: 0; background: #59d18a; border: none; color: #0b0b12; font-weight: 700;
	padding: 5px 8px; border-radius: 6px; font-size: 12px; }

/* The base rules above set display:flex unconditionally, which (being an author rule) beats
 * the user-agent's default [hidden]{display:none} at equal specificity — so the .hidden DOM
 * property alone would NOT actually hide these two panels. Force it explicitly here. */
.panel-center[hidden], .class-select[hidden] { display: none; }

.toast { position: absolute; top: 60px; left: 50%; transform: translateX(-50%); padding: 6px 14px;
	border-radius: 6px; font-size: 13px; font-weight: 600; opacity: 0; transition: opacity 0.2s ease; }
.toast.show { opacity: 1; }
.toast.ok { background: rgba(89,209,138,0.9); color: #0b0b12; }
.toast.bad { background: rgba(239,111,108,0.9); color: #0b0b12; }

.fullscreen-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
	flex-direction: column; gap: 14px; background: rgba(6,6,10,0.82); text-align: center; }
.fullscreen-overlay.hidden { display: none; }
.fullscreen-overlay h1 { font-size: 22px; margin: 0; }
.fullscreen-overlay p { margin: 0; opacity: 0.85; font-size: 14px; }
.fullscreen-overlay button { pointer-events: auto; background: #4fd1ff; border: none; color: #0b0b12;
	font-weight: 700; padding: 10px 22px; border-radius: 8px; font-size: 14px; }
`;

/**
 * All non-canvas UI (HUD, shop prompt, class selection, purchase/death/match-end overlays) as
 * plain DOM elements layered on top of the Phaser canvas. Kept as DOM rather than Phaser text/
 * buttons because: crisper text at arbitrary DPR, and reliable touch hit-targets for buttons
 * without competing with the canvas's own pointer handling for the joystick/dash button — the
 * overlay root has `pointer-events: none` and only individual buttons opt back in, so it never
 * blocks touches meant for the game canvas underneath.
 */
export class UIOverlay {
	private readonly root: HTMLDivElement;
	private readonly healthFill: HTMLDivElement;
	private readonly healthText: HTMLSpanElement;
	private readonly moneyText: HTMLSpanElement;
	private readonly weaponText: HTMLSpanElement;
	private readonly dashFill: HTMLDivElement;
	private readonly dashText: HTMLSpanElement;

	private readonly shopPanel: HTMLDivElement;
	private readonly shopCostText: HTMLParagraphElement;
	private readonly shopButton: HTMLButtonElement;
	private readonly classPanel: HTMLDivElement;

	private readonly toast: HTMLDivElement;
	private toastTimer: number | undefined;

	private readonly deathOverlay: HTMLDivElement;
	private readonly deathText: HTMLParagraphElement;
	private deathHideTimer: number | undefined;

	private readonly matchEndOverlay: HTMLDivElement;
	private readonly matchEndText: HTMLParagraphElement;

	constructor(private readonly net: NetworkManager) {
		const style = document.createElement("style");
		style.textContent = STYLE;
		document.head.appendChild(style);

		this.root = el("div", "");
		this.root.id = "ui-overlay";

		// HUD
		const hud = el("div", "hud-panel");
		const healthRow = el("div", "hud-row");
		healthRow.append(el("span", "hud-label", "HP"));
		const healthTrack = el("div", "hud-bar-track");
		this.healthFill = el("div", "hud-bar-fill");
		healthTrack.append(this.healthFill);
		this.healthText = el("span", "", "100/100");
		healthRow.append(healthTrack, this.healthText);

		const moneyRow = el("div", "hud-row");
		moneyRow.append(el("span", "hud-label", "Money"));
		this.moneyText = el("span", "", "0");
		moneyRow.append(this.moneyText);

		const weaponRow = el("div", "hud-row");
		weaponRow.append(el("span", "hud-label", "Weapon"));
		this.weaponText = el("span", "", "Shooter Lv.1");
		weaponRow.append(this.weaponText);

		const dashRow = el("div", "hud-row");
		dashRow.append(el("span", "hud-label", "Dash"));
		const dashTrack = el("div", "hud-bar-track");
		this.dashFill = el("div", "hud-bar-fill dash");
		dashTrack.append(this.dashFill);
		this.dashText = el("span", "", "Ready");
		dashRow.append(dashTrack, this.dashText);

		hud.append(healthRow, moneyRow, weaponRow, dashRow);

		// Invite panel — the actual fix for "players keep spawning alone in the top-left corner":
		// without a visible, shareable link, a second device has no way to actually join the same
		// match code (and no way to even see it — an installed/standalone PWA has no address bar),
		// so each device silently starts its own separate solo match and always lands at spawn 0.
		const invite = el("div", "invite-panel");
		invite.append(el("span", "", `Match: ${this.net.matchCode}`));
		const shareButton = el("button", "", "Share Link");
		shareButton.addEventListener("click", () => this.shareInviteLink());
		invite.append(shareButton);

		// Shop prompt
		this.shopPanel = el("div", "panel-center");
		this.shopPanel.hidden = true;
		this.shopCostText = el("p", "", "");
		this.shopPanel.append(this.shopCostText);
		this.shopButton = el("button", "", "Buy");
		this.shopButton.addEventListener("click", () => this.net.buyWeaponLevel());
		this.shopPanel.append(this.shopButton);

		// Class selection
		this.classPanel = el("div", "class-select");
		this.classPanel.hidden = true;
		for (const weapon of Object.values(WEAPONS)) {
			if (weapon.id === "shooter") continue;
			const button = el("button", "", weapon.displayName);
			button.addEventListener("click", () => this.net.chooseClass(weapon.id));
			this.classPanel.append(button);
		}

		// Toast
		this.toast = el("div", "toast");

		// Death overlay
		this.deathOverlay = el("div", "fullscreen-overlay hidden");
		this.deathOverlay.append(el("h1", "", "You died"));
		this.deathText = el("p", "", "");
		this.deathOverlay.append(this.deathText);

		// Match end overlay
		this.matchEndOverlay = el("div", "fullscreen-overlay hidden");
		this.matchEndOverlay.append(el("h1", "", "Match over"));
		this.matchEndText = el("p", "", "");
		const reloadButton = el("button", "", "Play again");
		reloadButton.addEventListener("click", () => window.location.reload());
		this.matchEndOverlay.append(this.matchEndText, reloadButton);

		this.root.append(
			hud,
			invite,
			this.shopPanel,
			this.classPanel,
			this.toast,
			this.deathOverlay,
			this.matchEndOverlay,
		);

		const mount = document.getElementById("game") ?? document.body;
		mount.appendChild(this.root);
	}

	/** `resolveMatchCode()` (client/src/net/socket.ts) already writes `?match=<code>` into the
	 * current URL via `history.replaceState` on load, so `location.href` IS the correct invite
	 * link already — no need to rebuild it. Prefers the native share sheet on mobile (the actual
	 * way someone sends a link to a friend); falls back to clipboard on desktop. */
	private shareInviteLink(): void {
		const link = window.location.href;
		if (navigator.share) {
			navigator.share({ title: "Join my PvP Shooter match", url: link }).catch(() => {});
			return;
		}
		if (navigator.clipboard?.writeText) {
			navigator.clipboard.writeText(link).then(
				() => this.flashToast("Link copied!", true),
				() => this.flashToast("Couldn't copy — copy the URL bar instead", false),
			);
			return;
		}
		this.flashToast("Copy the URL bar to invite a friend", false);
	}

	private flashToast(text: string, ok: boolean): void {
		window.clearTimeout(this.toastTimer);
		this.toast.className = `toast show ${ok ? "ok" : "bad"}`;
		this.toast.textContent = text;
		this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 1800);
	}

	/** Drive the HUD from the local player's state; falls back to sensible defaults before `state` arrives. */
	updateHud(localPlayer: PlayerState | null): void {
		const maxHealth = localPlayer?.maxHealth ?? MATCH_RULES.maxHealth;
		const health = localPlayer?.health ?? maxHealth;
		const healthRatio = maxHealth > 0 ? Math.max(0, health / maxHealth) : 0;
		this.healthFill.style.width = `${healthRatio * 100}%`;
		this.healthText.textContent = `${Math.max(0, Math.round(health))}/${maxHealth}`;

		this.moneyText.textContent = String(localPlayer?.money ?? 0);

		const weaponId = localPlayer?.weapon ?? "shooter";
		const level = localPlayer?.weaponLevel ?? 1;
		this.weaponText.textContent = `${WEAPONS[weaponId].displayName} Lv.${level}`;

		const cooldownRemaining = localPlayer?.dashCooldownRemainingMs ?? 0;
		if (cooldownRemaining > 0) {
			const ratio = 1 - Math.min(cooldownRemaining / MATCH_RULES.dashCooldownMs, 1);
			this.dashFill.style.width = `${ratio * 100}%`;
			this.dashText.textContent = `${(cooldownRemaining / 1000).toFixed(1)}s`;
		} else {
			this.dashFill.style.width = "100%";
			this.dashText.textContent = "Ready";
		}
	}

	/** Show the shop buy prompt whenever the local player is standing inside any shop zone. */
	updateShopPrompt(localPlayer: PlayerState | null, shopZones: ShopZoneState[]): void {
		const inZone = shopZones.some((zone) => isWithinShopZone(localPlayer ?? undefined, zone));
		this.shopPanel.hidden = !inZone;
		if (inZone && localPlayer) {
			if (localPlayer.weaponLevel >= MAX_WEAPON_LEVEL) {
				this.shopCostText.textContent = "Weapon already at max level";
				this.shopButton.disabled = true;
			} else {
				const cost = weaponLevelCost(localPlayer.weaponLevel);
				this.shopCostText.textContent = `Shop: buy weapon level ${localPlayer.weaponLevel + 1} (cost ${cost})`;
				this.shopButton.disabled = localPlayer.money < cost;
			}
		}
	}

	/**
	 * Class-unlock gate: the wire protocol (shared/protocol.ts `PlayerState`) has no explicit
	 * "class chosen" flag, so `weaponLevel >= CLASS_UNLOCK_LEVEL` while `weapon === "shooter"` is
	 * the only signal available to infer "eligible but not yet specialized." This is called out
	 * per the task brief as an assumption worth a reviewer's attention, not a spec guarantee.
	 */
	updateClassSelect(localPlayer: PlayerState | null): void {
		const eligible = !!localPlayer && localPlayer.weapon === "shooter" && localPlayer.weaponLevel >= CLASS_UNLOCK_LEVEL;
		this.classPanel.hidden = !eligible;
	}

	flashPurchaseResult(message: PurchaseResultMessage): void {
		window.clearTimeout(this.toastTimer);
		this.toast.className = `toast show ${message.success ? "ok" : "bad"}`;
		this.toast.textContent = message.success ? "Weapon level up!" : message.reason ?? "Purchase failed";
		this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 1500);
	}

	showError(message: string): void {
		window.clearTimeout(this.toastTimer);
		this.toast.className = "toast show bad";
		this.toast.textContent = message;
		this.toastTimer = window.setTimeout(() => this.toast.classList.remove("show"), 2500);
	}

	showDeathOverlay(message: DeathMessage, killerName: string | null): void {
		const killerNote = killerName ? `Killed by ${killerName}. ` : "";
		this.deathText.textContent = `${killerNote}Respawning at level ${message.newLevel}.`;
		this.deathOverlay.classList.remove("hidden");
		window.clearTimeout(this.deathHideTimer);
		this.deathHideTimer = window.setTimeout(() => this.deathOverlay.classList.add("hidden"), 2500);
	}

	showMatchEnd(message: MatchEndMessage, winnerName: string | null): void {
		// A death and the match ending can arrive back-to-back (e.g. the final kill); don't leave
		// the respawn overlay stacked underneath the match-end screen.
		window.clearTimeout(this.deathHideTimer);
		this.deathOverlay.classList.add("hidden");
		const outcome =
			message.winnerId === null ? "It's a draw." : `${winnerName ?? message.winnerId} wins!`;
		const reason = message.reason === "kills" ? "kill limit reached" : "time limit reached";
		this.matchEndText.textContent = `${outcome} (${reason})`;
		this.matchEndOverlay.classList.remove("hidden");
	}
}
