import { json, upstream } from "@/lib/server/upstream";

const SID = /^[A-Za-z0-9_]{3,40}$/;

/**
 * GET /api/aerial/{sid}: the cached Vexcel orthophoto around the unit's building, passed through
 * from the API (from aerial, estimated; imagery © Vexcel Imaging). There is no fixture image: when
 * the API has none, the card says so.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/aerial/[sid]">) {
  const { sid } = await ctx.params;
  if (!SID.test(sid)) return json({ detail: "bad model id" }, "live", { status: 400 });
  const up = await upstream(`/api/aerial/${sid}`);
  if (!up.ok) return json({ detail: up.reason }, up.status === null ? "replay" : "live", { status: up.status ?? 503 });
  return new Response(up.res.body, {
    headers: {
      "content-type": up.res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}
