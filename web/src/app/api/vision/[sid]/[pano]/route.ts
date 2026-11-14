import { json, upstream } from "@/lib/server/upstream";

const SID = /^[A-Za-z0-9_]{3,40}$/;
const PANO = /^[A-Za-z0-9_-]{3,80}$/;

/** GET /api/vision/{sid}/{pano}: one defurnished panorama image, passed through from the API. */
export async function GET(_req: Request, ctx: RouteContext<"/api/vision/[sid]/[pano]">) {
  const { sid, pano } = await ctx.params;
  if (!SID.test(sid) || !PANO.test(pano)) return json({ detail: "bad id" }, "live", { status: 400 });
  const up = await upstream(`/api/vision/${sid}/${pano}`);
  if (!up.ok) return json({ detail: up.reason }, up.status === null ? "replay" : "live", { status: up.status ?? 503 });
  return new Response(up.res.body, {
    headers: {
      "content-type": up.res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}
