import type { NextRequest } from "next/server";
import { json, upstream } from "@/lib/server/upstream";

/**
 * POST /api/answers {outbox_id | sid, text?, answers?, from?}: a leasing office's reply, forwarded by
 * the bridge. The API logs it; a room the scan left unknown that it answers gains basis "asked".
 */
export async function POST(req: NextRequest) {
  const up = await upstream("/api/answers", { method: "POST", body: await req.text(), headers: { "content-type": "application/json" } }, 15_000);
  if (up.ok) return json(await up.res.json(), "live");
  return json({ detail: up.reason }, "live", { status: up.status ?? 503 });
}
