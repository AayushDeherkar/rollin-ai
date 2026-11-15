import { connection } from "next/server";
import { fixtureAsScanned } from "@/lib/fixtures";
import { json, upstream } from "@/lib/server/upstream";

const SID = /^[A-Za-z0-9_]{3,40}$/;

/**
 * GET /api/demo: the unit presenter mode (`/?demo=1`) opens, as `{ sid }`.
 * Live: the API's demo-main unit (GET /api/health `demo.main_sid`; before that field existed,
 * the first unit in the demo pack). The real id never appears in tracked files. Without the API or a demo pack: the synthetic
 * contract unit, marked as a replay.
 */
export async function GET() {
  // asked per request: the API (and its demo pack) can change after the build
  await connection();
  const up = await upstream("/api/health");
  if (up.ok) {
    const body = (await up.res.json().catch(() => null)) as { demo?: { main_sid?: unknown; units?: Record<string, unknown> } } | null;
    const main = body?.demo?.main_sid;
    const sid = typeof main === "string" ? main : Object.keys(body?.demo?.units ?? {})[0];
    if (sid && SID.test(sid)) return json({ sid }, "live");
    return json({ sid: fixtureAsScanned.model }, "replay", { reason: "The API has no demo pack" });
  }
  return json({ sid: fixtureAsScanned.model }, "replay", { reason: up.reason });
}
