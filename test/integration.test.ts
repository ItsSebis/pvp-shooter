import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerToClientMessage } from "../shared/protocol";

/**
 * Light integration sanity check for the join -> joined -> state flow over a real WebSocket
 * through the Worker's fetch handler and into the MatchRoom Durable Object. Full multiplayer
 * tick-loop integration testing (movement, combat, economy, match end) is a known gap here —
 * skipped given time constraints, per the task's explicit allowance; this test exists to catch
 * wiring regressions in the accept/join/broadcast path, not to validate simulation behavior.
 */
function waitForMessage(ws: WebSocket): Promise<ServerToClientMessage> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("timed out waiting for message")), 5000);
		ws.addEventListener(
			"message",
			(event) => {
				clearTimeout(timeout);
				resolve(JSON.parse(event.data as string) as ServerToClientMessage);
			},
			{ once: true },
		);
	});
}

describe("MatchRoom WebSocket flow", () => {
	it("responds to join with joined, then broadcasts state", async () => {
		const res = await SELF.fetch("http://example.com/ws?match=test-match", {
			headers: { Upgrade: "websocket" },
		});
		expect(res.status).toBe(101);
		const ws = res.webSocket;
		expect(ws).not.toBeNull();
		if (!ws) throw new Error("expected a WebSocket on the 101 response");
		ws.accept();

		ws.send(JSON.stringify({ type: "join", name: "Tester" }));
		const joined = await waitForMessage(ws);
		expect(joined.type).toBe("joined");
		if (joined.type !== "joined") throw new Error("expected joined message");
		expect(joined.matchCode).toBe("test-match");
		expect(typeof joined.playerId).toBe("string");

		const state = await waitForMessage(ws);
		expect(state.type).toBe("state");
		if (state.type !== "state") throw new Error("expected state message");
		expect(state.players).toHaveLength(1);
		expect(state.players[0].id).toBe(joined.playerId);
		expect(state.players[0].alive).toBe(true);
		expect(state.players[0].health).toBeGreaterThan(0);

		ws.close();
	});
});
