import type { NextRequest } from "next/server";
import { json, upstream } from "@/lib/server/upstream";

const OUTBOX_ID = /^\d{8}T\d{6}_[0-9a-f]{6}$/;

/** POST /api/outbox/{id}/delivered {via?, detail?}: the bridge delivered one queued message. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/outbox/[id]/delivered">) {
  const { id } = await ctx.params;
  if (!OUTBOX_ID.test(id)) return json({ detail: "bad outbox id" }, "live", { status: 400 });
  const up = await upstream(`/api/outbox/${id}/delivered`, { method: "POST", body: await req.text(), headers: { "content-type": "application/json" } });
  if (up.ok) return json(await up.res.json(), "live");
  return json({ detail: up.reason }, "live", { status: up.status ?? 503 });
}
