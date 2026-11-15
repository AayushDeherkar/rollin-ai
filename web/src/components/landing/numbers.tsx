"use client";

/**
 * The batch's numbers, read from /api/insights and nothing else: how many units stay fully reachable
 * as the chair gets wider, as scanned and with offset hinges, and what hinges unlock at the
 * reference chair. Every figure carries its basis and scope from the same response. Without the
 * batch (a deployment with no API), it says so and shows no numbers.
 */
import { useEffect, useRef, useState } from "react";

interface Row {
  width_in: number;
  length_in: number;
  fully_reachable: number;
  fully_reachable_with_hinges: number;
}
export interface Sweep {
  rows: Row[];
  units: number;
  area: string;
  radiusKm: number | null;
  unitsMeans: string;
  fullyMeans: string;
  hingesMeans: string;
  lengthRule: string;
  basis: string;
  generated: string;
  reference: { chair: [number, number]; reachable: number; unlocked: number } | null;
}

/** the response's sweep, or null when any part the page needs is missing */
export function readSweep(json: unknown): Sweep | null {
  const s = (json as { sweep?: Record<string, unknown> } | null)?.sweep as Record<string, any> | null | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!s || !Array.isArray(s.sweep) || typeof s.scope?.units !== "number") return null;
  const rows: Row[] = s.sweep.filter(
    (r: Partial<Row>) => typeof r.width_in === "number" && typeof r.fully_reachable === "number" && typeof r.fully_reachable_with_hinges === "number",
  );
  if (rows.length < 2) return null;
  const ref = s.at_reference_chair;
  return {
    rows,
    units: s.scope.units,
    area: String(s.scope.area ?? "the batch area"),
    radiusKm: typeof s.scope.radius_km === "number" ? s.scope.radius_km : null,
    unitsMeans: String(s.scope.units_means ?? ""),
    fullyMeans: String(s.definitions?.fully_reachable ?? ""),
    hingesMeans: String(s.definitions?.unlocked_by_hinges ?? ""),
    lengthRule: String(s.length_rule?.text ?? ""),
    basis: String(s.basis ?? "estimated"),
    generated: typeof s.generated_at === "string" ? s.generated_at.slice(0, 10) : "",
    reference:
      ref && Array.isArray(ref.chair_in) && typeof ref.fully_reachable === "number" && typeof ref.unlocked_by_hinges === "number"
        ? { chair: [ref.chair_in[0], ref.chair_in[1]], reachable: ref.fully_reachable, unlocked: ref.unlocked_by_hinges }
        : null,
  };
}

export function useSweep(): { sweep: Sweep | null; state: "loading" | "ready" | "none" } {
  const [got, setGot] = useState<{ sweep: Sweep | null; state: "loading" | "ready" | "none" }>({ sweep: null, state: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/insights", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const sweep = readSweep(j);
        setGot({ sweep, state: sweep ? "ready" : "none" });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setGot({ sweep: null, state: "none" });
      });
    return () => ctl.abort();
  }, []);
  return got;
}

/** fully reachable units against chair width: as scanned (solid) and with offset hinges (dashed) */
export function SweepChart({ sweep, lineRef }: { sweep: Sweep; lineRef?: React.Ref<SVGPathElement> }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = Math.round(Math.min(340, Math.max(220, w * 0.45)));
  const pad = { l: 56, r: 16, t: 16, b: 48 };
  const xs = sweep.rows.map((r) => r.width_in);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMax = Math.max(...sweep.rows.map((r) => r.fully_reachable_with_hinges), 1);
  const top = Math.ceil(yMax / 50) * 50;
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
  const path = (k: "fully_reachable" | "fully_reachable_with_hinges") =>
    sweep.rows.map((r, i) => `${i ? "L" : "M"}${X(r.width_in).toFixed(1)},${Y(r[k]).toFixed(1)}`).join("");
  const ticksY = Array.from({ length: top / 50 + 1 }, (_, i) => i * 50).filter((v, _, a) => a.length <= 7 || v % 100 === 0);
  const ref = sweep.reference;
  return (
    <div ref={box} className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label={`Fully reachable units by chair width, from ${sweep.rows[0].fully_reachable} at ${x0} in to ${sweep.rows.at(-1)!.fully_reachable} at ${x1} in, of ${sweep.units} units. Estimated.`}
        className="block max-w-full"
      >
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(v)} y2={Y(v)} stroke="var(--rule)" />
            <text x={pad.l - 10} y={Y(v)} dy="0.35em" textAnchor="end" className="measure fill-ink-soft" fontSize="16">
              {v}
            </text>
          </g>
        ))}
        {sweep.rows.map((r) => (
          <text key={r.width_in} x={X(r.width_in)} y={h - pad.b + 24} textAnchor="middle" className="measure fill-ink-soft" fontSize="16">
            {r.width_in % 2 === 0 || sweep.rows.length <= 6 ? r.width_in : ""}
          </text>
        ))}
        <text x={w - pad.r} y={h - 4} textAnchor="end" className="fill-ink-soft" fontSize="16">
          chair width, in
        </text>
        {ref && (
          <line x1={X(ref.chair[0])} x2={X(ref.chair[0])} y1={pad.t} y2={h - pad.b} stroke="var(--rule-strong)" strokeDasharray="2 4" />
        )}
        <path d={path("fully_reachable_with_hinges")} fill="none" stroke="var(--ink-soft)" strokeWidth={2} strokeDasharray="7 5" />
        <path ref={lineRef} d={path("fully_reachable")} fill="none" stroke="var(--ink)" strokeWidth={3} pathLength={1} strokeDasharray="1 0" />
        {sweep.rows.map((r) => (
          <circle key={r.width_in} cx={X(r.width_in)} cy={Y(r.fully_reachable)} r={3.5} fill="var(--ink)" />
        ))}
      </svg>
    </div>
  );
}
