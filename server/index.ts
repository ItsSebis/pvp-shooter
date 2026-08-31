import { MatchRoom } from "./match-room";

export { MatchRoom };

/**
 * Worker entry point. Routes WebSocket upgrades for a match to that match's Durable Object
 * (one instance per match code, via getByName so the same code always reaches the same room).
 * Everything else falls through to the static client bundle (env.ASSETS).
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/ws") {
			const matchCode = url.searchParams.get("match");
			if (!matchCode) {
				return new Response("Missing 'match' query param", { status: 400 });
			}
			if (request.headers.get("Upgrade") !== "websocket") {
				return new Response("Expected WebSocket upgrade", { status: 426 });
			}
			const stub = env.MATCH_ROOM.getByName(matchCode);
			return stub.fetch(request);
		}

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
