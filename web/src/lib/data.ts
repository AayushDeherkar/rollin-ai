"use client";

/**
 * Client-side loading from this app's own /api routes (which forward to the Rollin' API, or
 * replay the contract fixtures when it is not reachable). Every result says where it came from.
 */
import { useEffect, useState } from "react";
import { ORIGIN_HEADER, REPLAY_REASON_HEADER, type Origin, type UnitResult, type UnitsList } from "./contract";

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T; origin: Origin; reason: string | null };

interface Got<T> {
  data: T;
  origin: Origin;
  reason: string | null;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<Got<T>> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : res.statusText;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const origin: Origin = res.headers.get(ORIGIN_HEADER) === "live" ? "live" : "replay";
  return { data: body as T, origin, reason: res.headers.get(REPLAY_REASON_HEADER) };
}

/** Keyed result: a load for an old key reads as "loading" for the new one, without a reset in an effect. */
function useKeyedLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<Got<T>>): Load<T> {
  const [state, setState] = useState<{ key: string; load: Load<T> } | null>(null);
  useEffect(() => {
    if (key === null) return;
    const ac = new AbortController();
    load(ac.signal).then(
      (got) => setState({ key, load: { status: "ready", ...got } }),
      (err: unknown) => {
        if (ac.signal.aborted) return;
        setState({ key, load: { status: "error", message: err instanceof Error ? err.message : String(err) } });
      },
    );
    return () => ac.abort();
    // `load` is rebuilt every render; the key says when to fetch again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return { status: "loading" };
  return state?.key === key ? state.load : { status: "loading" };
}

export function useUnitsList(): Load<UnitsList> {
  return useKeyedLoad("units", (signal) => getJson<UnitsList>("/api/units", signal));
}

export interface UnitPair {
  asScanned: UnitResult;
  hinges: UnitResult | null;
}

/** Both scenarios of one unit. Replay if either half was replayed. */
export function useUnitPair(sid: string | null): Load<UnitPair> {
  return useKeyedLoad(sid, async (signal) => {
    const base = `/api/units/${encodeURIComponent(sid ?? "")}`;
    const [a, h] = await Promise.all([getJson<UnitResult>(base, signal), getJson<UnitResult>(`${base}?hinges=1`, signal).catch(() => null)]);
    const replay = a.origin === "replay" || h?.origin === "replay";
    return {
      data: { asScanned: a.data, hinges: h?.data ?? null },
      origin: replay ? "replay" : "live",
      reason: a.reason ?? h?.reason ?? null,
    };
  });
}
