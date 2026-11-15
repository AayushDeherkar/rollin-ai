"use client";

/**
 * Client-side loading from this app's own /api routes (which forward to the Rollin' API, or
 * replay the contract fixtures when it is not reachable). Every result says where it came from.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ORIGIN_HEADER,
  REPLAY_REASON_HEADER,
  type Origin,
  type UnitResult,
  type UnitsList,
} from "./contract";

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T; origin: Origin; reason: string | null };

interface Got<T> {
  data: T;
  origin: Origin;
  reason: string | null;
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Units the API answered 404 for (no model cached). The default pick skips them; the list
 * says so. Kept for the session: the batch's cache does not change while the page is open.
 */
let noPlan: readonly string[] = [];
const noPlanListeners = new Set<() => void>();
function markNoPlan(sid: string) {
  if (noPlan.includes(sid)) return;
  noPlan = [...noPlan, sid];
  noPlanListeners.forEach((l) => l());
}
const NONE: readonly string[] = [];
export function useNoPlan(): readonly string[] {
  return useSyncExternalStore(
    (l) => {
      noPlanListeners.add(l);
      return () => noPlanListeners.delete(l);
    },
    () => noPlan,
    () => NONE,
  );
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<Got<T>> {
  const res = await fetch(url, { signal, cache: "no-store" });
  const body = await res.json().catch((err: unknown) => {
    if (signal.aborted) throw err; // a cancelled load must not resolve as data
    return null;
  });
  if (!res.ok) {
    const detail =
      body && typeof body.detail === "string" ? body.detail : res.statusText;
    throw new HttpError(detail || `HTTP ${res.status}`, res.status);
  }
  const origin: Origin =
    res.headers.get(ORIGIN_HEADER) === "live" ? "live" : "replay";
  return {
    data: body as T,
    origin,
    reason: res.headers.get(REPLAY_REASON_HEADER),
  };
}

/** Keyed result: a load for an old key reads as "loading" for the new one, without a reset in an effect. */
function useKeyedLoad<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<Got<T>>,
  /** keep showing the last result while a key this says is the same thing refetches (no flash of loading) */
  keep?: (prev: string, next: string) => boolean,
): Load<T> {
  const [state, setState] = useState<{ key: string; load: Load<T> } | null>(
    null,
  );
  useEffect(() => {
    if (key === null) return;
    const ac = new AbortController();
    load(ac.signal).then(
      (got) => {
        if (!ac.signal.aborted)
          setState({ key, load: { status: "ready", ...got } });
      },
      (err: unknown) => {
        if (ac.signal.aborted) return;
        setState({
          key,
          load: {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      },
    );
    return () => ac.abort();
    // `load` is rebuilt every render; the key says when to fetch again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return { status: "loading" };
  if (state?.key === key) return state.load;
  if (state && state.load.status === "ready" && keep?.(state.key, key)) return state.load;
  return { status: "loading" };
}

export function useUnitsList(): Load<UnitsList> {
  return useKeyedLoad("units", (signal) =>
    getJson<UnitsList>("/api/units", signal),
  );
}

export interface UnitPair {
  asScanned: UnitResult;
  hinges: UnitResult | null;
}

/** Both scenarios of one unit. Replay if either half was replayed. */
/** `version` refetches the same unit (a leasing-office answer came in) without showing it as loading. */
export function useUnitPair(sid: string | null, version = 0): Load<UnitPair> {
  const key = sid === null ? null : `${sid}#${version}`;
  return useKeyedLoad(key, async (signal) => {
    const base = `/api/units/${encodeURIComponent(sid ?? "")}`;
    const [a, h] = await Promise.all([
      getJson<UnitResult>(base, signal).catch((err: unknown) => {
        if (sid && err instanceof HttpError && err.status === 404) markNoPlan(sid);
        throw err;
      }),
      getJson<UnitResult>(`${base}?hinges=1`, signal).catch((err: unknown) => {
        if (signal.aborted) throw err;
        return null; // a unit without a hinges result still draws as scanned
      }),
    ]);
    const replay = a.origin === "replay" || h?.origin === "replay";
    return {
      data: { asScanned: a.data, hinges: h?.data ?? null },
      origin: replay ? "replay" : "live",
      reason: a.reason ?? h?.reason ?? null,
    };
  }, (prev, next) => prev.split("#")[0] === next.split("#")[0]);
}
