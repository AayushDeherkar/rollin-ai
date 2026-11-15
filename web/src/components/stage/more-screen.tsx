"use client";

/**
 * "More" (M): everything the two-minute pitch leaves out, one keypress away. The chair-width
 * sweep from /api/insights, the owner number (units offset hinges open up, counted from the
 * ranked list), and a compact grid where each tile opens the real feature. Same plates and type
 * as the stage; nothing here is a slide. Every count is computed from API data and labelled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { UnitRow } from "@/lib/contract";
import { cn } from "@/lib/utils";

/** One point of the chair-width sweep: how many units every room is reachable in, at a chair width. */
interface SweepPoint {
  width: number;
  units: number;
}

/** The sweep, from whatever keys /api/insights uses for it; anything malformed is dropped, never filled in. */
function readSweep(x: unknown): { points: SweepPoint[]; of: number | null; length: number | null } | null {
  const b = x as Record<string, unknown> | null;
  const raw = (b?.sweep ?? b?.chair_sweep ?? b?.width_sweep) as unknown;
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { points?: unknown })?.points) ? (raw as { points: unknown[] }).points : null;
  if (!list) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof (v as { value?: unknown })?.value === "number" ? (v as { value: number }).value : null);
  const points = list
    .map((p) => {
      const o = p as Record<string, unknown>;
      const width = num(o.width_in ?? o.chair_width_in ?? o.w ?? o.width);
      const units = num(o.units ?? o.units_reachable ?? o.fully_reachable ?? o.count ?? o.fits);
      return width !== null && units !== null ? { width, units } : null;
    })
    .filter((p): p is SweepPoint => p !== null)
    .sort((a, b) => a.width - b.width);
  if (points.length < 2) return null;
  const meta = (Array.isArray(raw) ? b : raw) as Record<string, unknown>;
  return { points, of: num(meta?.total ?? meta?.units_total ?? meta?.of), length: num(meta?.length_in ?? meta?.chair_length_in) };
}

export interface MoreActions {
  aerial: (() => void) | null;
  panorama: () => void;
  memory: () => void;
  labels: () => void;
  tour: (() => void) | null;
}

export function MoreScreen({ units, onClose, actions }: { units: UnitRow[]; onClose: () => void; actions: MoreActions }) {
  const [insights, setInsights] = useState<{ body: unknown; live: boolean } | null>(null);
  const [limits, setLimits] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.focus();
    const ac = new AbortController();
    fetch("/api/insights", { signal: ac.signal })
      .then(async (r) => ({ body: r.ok ? await r.json() : null, live: r.headers.get("x-rollin-origin") === "live" }))
      .then((v) => !ac.signal.aborted && setInsights(v))
      .catch(() => {});
    return () => ac.abort();
  }, []);
  const sweep = useMemo(() => (insights?.live ? readSweep(insights.body) : null), [insights]);

  // the owner number, from the ranked list: units where offset hinges open every room (and the scan as is does not),
  // and units where they open at least one more room
  const owner = useMemo(() => {
    const rows = units.filter((u) => u.counts && u.with_hinges?.counts);
    const all = (c: { reachable: number; blocked: number; unknown: number }) => c.blocked === 0 && c.unknown === 0;
    const unlocked = rows.filter((u) => !all(u.counts) && all(u.with_hinges!.counts)).length;
    const gained = rows.filter((u) => u.with_hinges!.counts.reachable > u.counts.reachable).length;
    const chair = rows[0]?.chair_in ?? null;
    return { total: rows.length, unlocked, gained, chair };
  }, [units]);

  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="more-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="pointer-events-auto absolute inset-0 z-50 overflow-y-auto bg-paper outline-none"
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-8 py-8">
        <header className="flex items-baseline justify-between gap-6">
          <div className="flex items-baseline gap-4">
            <h1 id="more-title" className="display text-3xl font-bold">
              More
            </h1>
            <p className="text-base text-ink-soft">What the pitch leaves out. Each tile opens the real thing.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 items-center gap-2 border border-ink px-4 text-base font-semibold hover:bg-paper-deep">
            <X aria-hidden className="size-5" strokeWidth={2.25} />
            Back to the stage
            <kbd className="measure text-sm text-ink-soft">M</kbd>
          </button>
        </header>

        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
          <section aria-labelledby="sweep-title" className="flex flex-col gap-3 border border-rule-strong bg-paper-lift p-6">
            <h2 id="sweep-title" className="display text-2xl font-bold">
              Chair width against units that fit
            </h2>
            {sweep ? (
              <SweepChart sweep={sweep} />
            ) : (
              <p className="max-w-[60ch] text-base text-ink-soft">
                {insights === null
                  ? "Loading the chair-width sweep…"
                  : "The chair-width sweep comes from the API’s /api/insights, which this server does not serve yet. Nothing is drawn until it does."}
              </p>
            )}
          </section>

          <section aria-labelledby="owner-title" className="flex flex-col gap-3 border-2 border-ink bg-paper-lift p-6">
            <h2 id="owner-title" className="text-base font-semibold text-ink-soft">
              For an owner
            </h2>
            {owner.total > 0 ? (
              <>
                <p className="display measure text-[88px] leading-none font-bold">{owner.unlocked}</p>
                <p className="text-lg font-semibold">units where offset hinges open every room, and the doors as scanned do not.</p>
                <p className="text-base">
                  <span className="measure font-semibold">{owner.gained}</span> gain at least one room with hinges.
                </p>
                <p className="text-sm text-ink-soft">
                  Of {owner.total} ranked units, estimated from floor plans{owner.chair ? ` for a ${owner.chair[0]} × ${owner.chair[1]} in chair` : ""}; hinges add about
                  1.75 in (assumed).
                </p>
              </>
            ) : (
              <p className="text-base text-ink-soft">The ranked list is not loaded, so there is nothing to count yet.</p>
            )}
          </section>
        </div>

        <section aria-label="Everything else" className="grid grid-cols-3 gap-4">
          <Tile title="Aerial check" body="The building from above (Vexcel): entrance, ramps and paved paths, each answer labelled from aerial, estimated." action={actions.aerial} cta="See the building" off="Only for a live unit, not the replay." />
          <Tile title="Panorama check" body="A vision model reads the defurnished panoramas for the bathroom: tub or shower, grab bars, thresholds." action={actions.panorama} cta="See the bathroom" />
          <Tile title="Memory across texts" body="Text Rollin’ again and it uses the chair you gave last time, and says so. Each sender’s chair is kept apart." action={actions.memory} cta="Start a search" />
          <Tile title="Measured vs estimated" body="Door widths come from the scan; clear widths, room counts and anything from images are estimates, marked est." action={actions.labels} cta="See the ruler" />
          <Tile title="Jump into the 3D tour" body="The Matterport tour at the door that stops the chair, to check it as scanned." action={actions.tour} cta="Open the tour" off="Only for a live unit, not the replay." />
          <Tile title="Limitations and what is next" body="What the scan cannot tell us, and what we would build next." action={() => setLimits((v) => !v)} cta={limits ? "Hide" : "Read them"} pressed={limits} />
        </section>

        {limits && <Limits />}
      </div>
    </div>
  );
}

function Tile({ title, body, action, cta, off, pressed }: { title: string; body: string; action: (() => void) | null; cta: string; off?: string; pressed?: boolean }) {
  return (
    <div className="flex flex-col gap-2 border border-rule-strong bg-paper-lift p-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="flex-1 text-base text-ink-soft">{body}</p>
      {action ? (
        <button
          type="button"
          aria-pressed={pressed}
          onClick={action}
          className="h-10 self-start border border-ink px-4 text-base font-semibold transition-colors transition-draft hover:bg-paper-deep"
        >
          {cta}
        </button>
      ) : (
        <p className="text-sm text-ink-soft">{off}</p>
      )}
    </div>
  );
}

/** From the README's Limitations, shortened; "next" follows from them. */
function Limits() {
  const limits = [
    "Door widths are measured by the scan; the clear width is an estimate (5 cm off for the leaf and stop). Within an inch or so of the chair, bring a tape.",
    "Walls only: no furniture or fixtures, so turning space in bathrooms is an upper bound. Thresholds and steps are not in the geometry.",
    "Unknown stays unknown: a room behind an unmeasured opening is a question for the leasing office, never a verdict.",
    "Turning in place is approximated: the chair’s corners are not swept between headings.",
    "The offset-hinge gain, about 1.75 in, is an assumption inside a hinge maker’s stated 1.5 to 2 in.",
    "The batch is ranked for a 27 × 42 in chair; for other chairs only the top candidates are re-checked live.",
    "Vision and aerial answers are model estimates from images, labelled as such; multi-floor units are not checked by vision.",
  ];
  const next = [
    "Feed a width the leasing office gives back into the engine, so an asked room can get a verdict.",
    "Furniture and fixtures in the turning-space check.",
    "Re-rank the whole batch for each chair, not only the top candidates.",
    "Match panoramas to storeys, so multi-floor units get the vision check.",
  ];
  return (
    <section aria-label="Limitations and what is next" className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6 border border-rule-strong bg-paper-lift p-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">Limitations</h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base">
          {limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">What is next</h3>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base">
          {next.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Units with every room reachable against chair width: one line in ink, the demo chair and the ADA door marked. */
function SweepChart({ sweep }: { sweep: { points: SweepPoint[]; of: number | null; length: number | null } }) {
  const W = 760;
  const H = 300;
  const pad = { l: 56, r: 16, t: 16, b: 44 };
  const xs = sweep.points.map((p) => p.width);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMax = Math.max(...sweep.points.map((p) => p.units), 1);
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const d = sweep.points.map((p, i) => `${i ? "L" : "M"}${sx(p.width).toFixed(1)},${sy(p.units).toFixed(1)}`).join(" ");
  const ticks = [0, Math.round(yMax / 2), yMax];
  const marks = [
    { at: 27, label: "demo chair 27 in" },
    { at: 32, label: "ADA door 32 in" },
  ].filter((m) => m.at >= x0 && m.at <= x1);
  const first = sweep.points[0];
  const last = sweep.points[sweep.points.length - 1];
  return (
    <figure className="flex flex-col gap-2">
      <p className="text-base">
        At <span className="measure font-semibold">{first.width} in</span> every room is reachable in{" "}
        <span className="measure font-semibold">{first.units}</span> units; at <span className="measure font-semibold">{last.width} in</span>, in{" "}
        <span className="measure font-semibold">{last.units}</span>.
      </p>
      <svg role="img" aria-label={`Units with every room reachable, by chair width: ${sweep.points.map((p) => `${p.width} in, ${p.units}`).join("; ")}`} viewBox={`0 0 ${W} ${H}`} className="w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--rule)" strokeWidth={1} />
            <text x={pad.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle" className="measure fill-[var(--ink-soft)] text-[16px]">
              {t}
            </text>
          </g>
        ))}
        {marks.map((m) => (
          <g key={m.at}>
            <line x1={sx(m.at)} x2={sx(m.at)} y1={pad.t} y2={H - pad.b} stroke="var(--rule-strong)" strokeDasharray="4 4" />
            <text x={sx(m.at) + 6} y={pad.t + 14} className="fill-[var(--ink-soft)] text-[16px]">
              {m.label}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth={3} />
        {sweep.points.map((p) => (
          <circle key={p.width} cx={sx(p.width)} cy={sy(p.units)} r={4} fill="var(--ink)" />
        ))}
        {sweep.points.map((p, i) =>
          i % Math.ceil(sweep.points.length / 8) === 0 || i === sweep.points.length - 1 ? (
            <text key={`x${p.width}`} x={sx(p.width)} y={H - pad.b + 24} textAnchor="middle" className={cn("measure fill-[var(--ink-soft)] text-[16px]")}>
              {p.width}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="text-sm text-ink-soft">
        Chair width (in) against units with every room reachable{sweep.of ? `, of ${sweep.of}` : ""}
        {sweep.length ? `, chair length ${sweep.length} in` : ""}. Estimated from floor plans, as scanned. From /api/insights.
      </figcaption>
    </figure>
  );
}
