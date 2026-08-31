import type { ClientToServerMessage, ServerToClientMessage } from "../../../shared/protocol";

/**
 * Match-code contract: this client owns match creation/joining. A match code is any
 * non-empty string — the server just routes `/ws?match=<code>` to that DO by name via
 * getByName(), so any code is valid, no server-side allocation needed.
 *
 * Flow: if the page URL has `?match=<code>`, join that match. Otherwise generate a short
 * code (crypto-random, not Math.random — see workers-best-practices), connect with it, and
 * update the URL (history.replaceState) so the player can share the link with the second
 * player to join the same match.
 */
export function resolveMatchCode(): string {
	const url = new URL(window.location.href);
	const existing = url.searchParams.get("match");
	if (existing) return existing;

	const code = crypto.randomUUID().slice(0, 6);
	url.searchParams.set("match", code);
	window.history.replaceState(null, "", url.toString());
	return code;
}

export function connectToMatch(
	matchCode: string,
	onMessage: (message: ServerToClientMessage) => void,
): WebSocket {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const ws = new WebSocket(`${protocol}//${window.location.host}/ws?match=${encodeURIComponent(matchCode)}`);

	ws.addEventListener("message", (event) => {
		onMessage(JSON.parse(event.data) as ServerToClientMessage);
	});

	return ws;
}

export function send(ws: WebSocket, message: ClientToServerMessage): void {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(message));
	}
}
