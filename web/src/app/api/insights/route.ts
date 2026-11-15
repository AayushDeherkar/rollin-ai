import { connection } from "next/server";
import presetsJson from "../../../../../data/chair_presets.json";
import { json, upstream } from "@/lib/server/upstream";

/**
 * GET /api/insights → the API's insights (sourced chair presets, the chair-width sweep, units
 * unlocked by offset hinges). Without the API, or before it serves insights: only the sourced
 * presets, from the same tracked file the API reads (data/chair_presets.json), and nothing else.
 */
export async function GET() {
  await connection();
  const up = await upstream("/api/insights");
  if (up.ok) return json(await up.res.json(), "live");
  return json({ presets: presetsJson.presets, checked: presetsJson.checked, about: presetsJson.about }, "replay", {
    reason: `Sourced presets only (data/chair_presets.json). ${up.reason}`,
  });
}
