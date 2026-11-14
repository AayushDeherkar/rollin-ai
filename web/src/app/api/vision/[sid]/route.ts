import { json, upstream } from "@/lib/server/upstream";

const SID = /^[A-Za-z0-9_]{3,40}$/;

/**
 * GET /api/vision/{sid}: what a vision model saw in the unit's defurnished panoramas, per door or
 * room (from a photo, estimated), passed through from the API. No fixture: without the API the
 * room card offers no photo.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/vision/[sid]">) {
  const { sid } = await ctx.params;
  if (!SID.test(sid)) return json({ detail: "bad model id" }, "live", { status: 400 });
  const up = await upstream(`/api/vision/${sid}`);
  if (!up.ok) return json({ detail: up.reason }, up.status === null ? "replay" : "live", { status: up.status ?? 503 });
  return json(await up.res.json(), "live");
}
