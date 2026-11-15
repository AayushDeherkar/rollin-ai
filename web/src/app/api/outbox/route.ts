import { connection } from "next/server";
import { json, upstream } from "@/lib/server/upstream";

/**
 * GET /api/outbox → the API's approved messages not yet delivered, oldest first (contracts/README.md,
 * "Delivery and leasing-office answers"). Read by the iMessage bridge. Without the API there is
 * nothing to deliver, and the answer says why.
 */
export async function GET() {
  await connection();
  const up = await upstream("/api/outbox");
  if (up.ok) return json(await up.res.json(), "live");
  return json({ total: 0, items: [], detail: up.reason }, "replay", { status: up.status ?? 503, reason: up.reason });
}
