import { connection } from "next/server";
import presetsJson from "../../../../../data/chair_presets.json";
import { json, upstream } from "@/lib/server/upstream";

/**
 * GET /api/insights → the API's `{sweep, chair_presets, note}` (contracts/README.md, "Insights").
 * Without the API: the same shape with no sweep, and only the sourced presets, from the same
 * tracked file the API reads (data/chair_presets.json).
 */
export async function GET() {
  await connection();
  const up = await upstream("/api/insights");
  if (up.ok) return json(await up.res.json(), "live");
  return json({ sweep: null, chair_presets: presetsJson.presets, note: "no API: sourced presets only" }, "replay", {
    reason: `Sourced presets only (data/chair_presets.json). ${up.reason}`,
  });
}
