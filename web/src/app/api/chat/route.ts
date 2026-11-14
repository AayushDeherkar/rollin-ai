import type { NextRequest } from "next/server";
import { ORIGIN_HEADER, REPLAY_REASON_HEADER, type Origin } from "@/lib/contract";
import { upstream } from "@/lib/server/upstream";
import { localReplayStream } from "@/lib/server/replay-run";

function sse(body: ReadableStream<Uint8Array>, origin: Origin, reason?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
    [ORIGIN_HEADER]: origin,
  };
  if (reason) headers[REPLAY_REASON_HEADER] = reason;
  return new Response(body, { headers });
}

/**
 * POST /api/chat {message, profile} → SSE of agent events.
 * Tries, in order: the live agent; the API's recorded run (?replay=1); the synthetic contract run
 * played here. Anything but the live agent is labelled replay. `?replay=1` skips the live agent.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sp = req.nextUrl.searchParams;
  const pace = Math.min(10, Math.max(0, Number(sp.get("pace") ?? "1") || 0));
  const init = { method: "POST", body, headers: { "content-type": "application/json", accept: "text/event-stream" }, signal: req.signal };

  let reason = "Replay requested";
  if (sp.get("replay") !== "1") {
    const live = await upstream("/api/chat", init, 8000);
    if (live.ok && live.res.body) return sse(live.res.body, "live");
    reason = live.ok ? "API sent no stream" : live.reason;
  }
  const recorded = await upstream(`/api/chat?replay=1&pace=${pace}`, init, 8000);
  if (recorded.ok && recorded.res.body) return sse(recorded.res.body, "replay", `Recorded run from the API. ${reason}`.slice(0, 200));
  const why = recorded.ok ? "API sent no stream" : recorded.reason;
  return sse(await localReplayStream(pace, req.signal), "replay", `Synthetic contract run. ${why}`.slice(0, 200));
}
