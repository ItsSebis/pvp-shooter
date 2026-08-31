import type { ClientToServerMessage, ServerToClientMessage, Vector2 } from "../../../shared/protocol";
import type { WeaponId } from "../../../shared/game-config";
import { connectToMatch, resolveMatchCode, send } from "./socket";

type HandlerMap = {
	[K in ServerToClientMessage["type"]]?: Array<(msg: Extract<ServerToClientMessage, { type: K }>) => void>;
};

/**
 * Resolve a display name for the local player. Accepts `?name=` in the URL (handy for manual
 * multi-tab testing) and otherwise falls back to a short random tag so two players in the same
 * match are distinguishable in the HUD / match-end screen without any extra UI.
 */
function resolvePlayerName(): string {
	const url = new URL(window.location.href);
	const fromQuery = url.searchParams.get("name");
	if (fromQuery && fromQuery.trim().length > 0) return fromQuery.trim().slice(0, 16);
	return `Player-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Thin typed wrapper around the raw WebSocket connection (client/src/net/socket.ts) — adds
 * per-message-type event subscription, sequence numbering for `input` messages, and remembers
 * this client's own `playerId` once the server assigns it via `joined`.
 */
export class NetworkManager {
	readonly matchCode: string;
	playerId: string | null = null;

	private ws: WebSocket;
	private handlers: HandlerMap = {};
	private inputSeq = 0;

	constructor() {
		this.matchCode = resolveMatchCode();
		this.ws = connectToMatch(this.matchCode, (message) => this.dispatch(message));
		this.ws.addEventListener("open", () => {
			send(this.ws, { type: "join", name: resolvePlayerName() });
		});

		this.on("joined", (msg) => {
			this.playerId = msg.playerId;
		});
	}

	on<T extends ServerToClientMessage["type"]>(
		type: T,
		handler: (msg: Extract<ServerToClientMessage, { type: T }>) => void,
	): void {
		const list = (this.handlers[type] ??= []) as Array<(msg: Extract<ServerToClientMessage, { type: T }>) => void>;
		list.push(handler);
	}

	private dispatch(message: ServerToClientMessage): void {
		const list = this.handlers[message.type] as Array<(msg: typeof message) => void> | undefined;
		list?.forEach((handler) => handler(message));
	}

	sendInput(moveVector: Vector2, dashPressed: boolean): void {
		const msg: ClientToServerMessage = { type: "input", seq: this.inputSeq++, moveVector, dashPressed };
		send(this.ws, msg);
	}

	buyWeaponLevel(): void {
		send(this.ws, { type: "buyWeaponLevel" });
	}

	chooseClass(weapon: WeaponId): void {
		send(this.ws, { type: "chooseClass", weapon });
	}
}
