import { connection } from "next/server";
import { fixtureAsScanned } from "@/lib/fixtures";
import { json, upstream } from "@/lib/server/upstream";

const SID = /^[A-Za-z0-9_]{3,40}$/;

/**
 * GET /api/demo: the unit presenter mode (`/?demo=1`) opens, as `{ sid }`.
 * Live: the first unit in the API's demo pack (GET /api/health lists them with demo-main first;
 * the real id never appears in tracked files). Without the API or a demo pack: the synthetic
 * contract unit, marked as a replay.
 */
export async function GET() {
  // asked per request: the API (and its demo pack) can change after the build
  await connection();
  const up = await upstream("/api/health");
  if (up.ok) {
    const body = (await up.res.json().catch(() => null)) as { demo?: { units?: Record<string, unknown> } } | null;
    const first = Object.keys(body?.demo?.units ?? {})[0];
    if (first && SID.test(first)) return json({ sid: first }, "live");
    return json({ sid: fixtureAsScanned.model }, "replay", { reason: "The API has no demo pack" });
  }
  return json({ sid: fixtureAsScanned.model }, "replay", { reason: up.reason });
}
