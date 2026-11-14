/**
 * Server-side access to the Rollin' API (agent/server.py). The browser never calls it
 * directly: route handlers under app/api forward to it, so its address stays server-side
 * and its CORS settings do not matter.
 *
 * ROLLIN_API_URL, e.g. http://localhost:8000 (see web/.env.example). Unset = replay only.
 */
import { ORIGIN_HEADER, REPLAY_REASON_HEADER, type Origin } from "@/lib/contract";

const TIMEOUT_MS = 4000;

export function apiBase(): string | null {
  const url = process.env.ROLLIN_API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export type Upstream = { ok: true; res: Response } | { ok: false; status: number | null; reason: string };

/** Fetch from the API; never throws. A non-2xx answer comes back with its status and detail. */
export async function upstream(path: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Upstream> {
  const base = apiBase();
  if (!base) return { ok: false, status: null, reason: "ROLLIN_API_URL is not set" };
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch {
    // the address stays server-side; the browser only learns that the API did not answer
    return { ok: false, status: null, reason: "API not reachable" };
  }
  if (res.ok) return { ok: true, res };
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* not JSON */
  }
  return { ok: false, status: res.status, reason: `API answered ${res.status}: ${detail}`.slice(0, 200) };
}

export function json(body: unknown, origin: Origin, init: { status?: number; reason?: string } = {}): Response {
  const headers: Record<string, string> = { "content-type": "application/json", [ORIGIN_HEADER]: origin, "cache-control": "no-store" };
  if (init.reason) headers[REPLAY_REASON_HEADER] = init.reason;
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}
