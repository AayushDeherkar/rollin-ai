import type { NextRequest } from "next/server";
import { fixtureUnit } from "@/lib/fixtures";
import { json, upstream } from "@/lib/server/upstream";

const SID = /^[A-Za-z0-9_]{3,40}$/;

/**
 * GET /api/units/{sid}[?hinges=1]: the engine result from the API. If the API is unreachable,
 * or does not know a sid that the contract fixtures do, the fixture plan is replayed instead.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/units/[sid]">) {
  const { sid } = await ctx.params;
  if (!SID.test(sid)) return json({ detail: "bad model id" }, "live", { status: 400 });
  const hinges = ["1", "true"].includes(req.nextUrl.searchParams.get("hinges") ?? "");
  const up = await upstream(`/api/units/${sid}${req.nextUrl.search}`);
  if (up.ok) return json(await up.res.json(), "live");
  const fixture = fixtureUnit(sid, hinges);
  if (fixture) return json(fixture, "replay", { reason: up.reason });
  return json({ detail: up.reason }, up.status === null ? "replay" : "live", { status: up.status ?? 503 });
}
