import type { NextRequest } from "next/server";
import { json, upstream } from "@/lib/server/upstream";
import { LOCAL_REPLAY_TAG } from "@/lib/server/replay-run";

/**
 * POST /api/approve {action_id, approved} → the API's approval gate (agent/approvals.py).
 * For a run replayed here because the API was down, nothing can be sent, and the answer says so.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let parsed: { action_id?: unknown; approved?: unknown } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ detail: "body must be JSON {action_id, approved}" }, "live", { status: 400 });
  }
  if (typeof parsed.action_id !== "string" || typeof parsed.approved !== "boolean") {
    return json({ detail: "body must be JSON {action_id, approved}" }, "live", { status: 400 });
  }
  if (parsed.action_id.endsWith(LOCAL_REPLAY_TAG)) {
    return json(
      { action_id: parsed.action_id, approved: parsed.approved, action: "send_message", status: "not sent: replayed run", replay: true },
      "replay",
      { reason: "Synthetic contract run played by the web app" },
    );
  }
  const up = await upstream("/api/approve", { method: "POST", body: raw, headers: { "content-type": "application/json" } });
  if (up.ok) return json(await up.res.json(), "live");
  return json({ detail: up.reason }, "live", { status: up.status ?? 503 });
}
