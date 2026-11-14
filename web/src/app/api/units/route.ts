import type { NextRequest } from "next/server";
import { fixtureUnitsList } from "@/lib/fixtures";
import { json, upstream } from "@/lib/server/upstream";

/** GET /api/units: the API's ranked list, or the contract fixture replayed if the API can't give one. */
export async function GET(req: NextRequest) {
  const up = await upstream(`/api/units${req.nextUrl.search}`);
  if (up.ok) return json(await up.res.json(), "live");
  return json(fixtureUnitsList, "replay", { reason: up.reason });
}
