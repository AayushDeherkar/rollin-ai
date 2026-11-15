import type { NextRequest } from "next/server";
import { json, upstream } from "@/lib/server/upstream";

/**
 * GET /api/events → the API's SSE stream of `delivered` and `answer` events (not part of any chat
 * run), passed through as it arrives. Last-Event-ID is forwarded so a reconnect misses nothing.
 * Without the API: 503, and the page tries again later.
 */
export async function GET(req: NextRequest) {
  const last = req.headers.get("last-event-id");
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (last && /^[\w-]{1,64}$/.test(last)) headers["last-event-id"] = last;
  const up = await upstream("/api/events", { headers, signal: req.signal });
  if (up.ok && up.res.body) {
    return new Response(up.res.body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
    });
  }
  return json({ detail: up.ok ? "API sent no stream" : up.reason }, "replay", { status: 503 });
}
