"use client";

/**
 * "More" (M): everything the two-minute pitch leaves out, one keypress away. The chair-width
 * sweep from /api/insights, the owner number (units offset hinges open up: from the sweep, else counted from the
 * ranked list), and a compact grid where each tile opens the real feature. Same plates and type
 * as the stage; nothing here is a slide. Every count is computed from API data and labelled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { UnitRow } from "@/lib/contract";
import { cn } from "@/lib/utils";

/** One width of the chair-size sweep: units with every room reachable, as scanned and with offset hinges. */
interface SweepPoint {
  width: number;
  scanned: number;
  hinges: number;
}

interface Sweep {
  points: SweepPoint[];
  /** usable units in the batch the sweep ran over */
  of: number | null;
  /** how chair length follows width (an assumption, said as such) */
  lengthRule: string | null;
  /** at the 27 x 42 in reference chair */
  reference: { chair: [number, number]; unlocked: number } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The sweep in /api/insights (`{sweep: {scope, sweep: [...], at_reference_chair, length_rule}}`,
 * contracts/README.md "Insights"). Anything malformed is dropped, never filled in.
 */
function readSweep(body: unknown): Sweep | null {
  const agg = (body as { sweep?: unknown } | null)?.sweep as Record<string, unknown> | null | undefined;
  if (!agg || !Array.isArray(agg.sweep)) return null;
  const points = (agg.sweep as Record<string, unknown>[])
    .map((o) => {
      const width = num(o?.width_in);
      const scanned = num(o?.fully_reachable);
      const hinges = num(o?.fully_reachable_with_hinges);
      return width !== null && scanned !== null && hinges !== null ? { width, scanned, hinges } : null;
    })
    .filter((p): p is SweepPoint => p !== null)
    .sort((x, y) => x.width - y.width);
  if (points.length < 2) return null;
  const ref = agg.at_reference_chair as { chair_in?: unknown; unlocked_by_hinges?: unknown } | undefined;
  const chair = Array.isArray(ref?.chair_in) ? ref.chair_in.map(num) : [];
  const unlocked = num(ref?.unlocked_by_hinges);
  const rule = (agg.length_rule as { text?: unknown } | undefined)?.text;
  return {
    points,
    of: num((agg.scope as { units?: unknown } | undefined)?.units),
    lengthRule: typeof rule === "string" ? rule : null,
    reference: chair.length === 2 && chair[0] !== null && chair[1] !== null && unlocked !== null ? { chair: [chair[0], chair[1]], unlocked } : null,
  };
}

export interface MoreActions {
  aerial: (() => void) | null;
  panorama: () => void;
  memory: () => void;
  labels: () => void;
  tour: (() => void) | null;
}

export function MoreScreen({
  units,
  unitsReplay,
  onClose,
  actions,
}: {
  units: UnitRow[];
  /** the ranked list is the replayed contract fixture (synthetic units), not the batch */
  unitsReplay: boolean;
  onClose: () => void;
  actions: MoreActions;
}) {
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
        if (e.key !== "Escape") return;
        // only More closes: a panel open underneath listens for Esc on the window too
        e.stopPropagation();
        onClose();
      }}
      className="pointer-events-auto absolute inset-0 z-50 overflow-y-auto bg-paper outline-none"
    >
      <div className="mx-auto flex max-w-[80rem] flex-col gap-[var(--gutter)] p-[var(--gutter)]">
        <header className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
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

        <div className="flex flex-wrap gap-[var(--gutter)] [&>*]:min-w-0">
          <section aria-labelledby="sweep-title" className="flex flex-[2_1_30rem] flex-col gap-3 border border-rule-strong bg-paper-lift p-6">
            <h2 id="sweep-title" className="display text-2xl font-bold">
              Chair width against units that fit
            </h2>
            {sweep ? (
              <SweepChart sweep={sweep} />
            ) : (
              <p className="max-w-[60ch] text-base text-ink-soft">
                {insights === null
                  ? "Loading the chair-width sweep…"
                  : "This server has no chair-width sweep (it comes from the API’s /api/insights), so nothing is drawn."}
              </p>
            )}
          </section>

          <section aria-labelledby="owner-title" className="flex flex-[1_1_17rem] flex-col gap-3 border-2 border-ink bg-paper-lift p-6">
            <h2 id="owner-title" className="text-base font-semibold text-ink-soft">
              For an owner
            </h2>
            {sweep?.reference ? (
              <>
                <p className="display measure text-3xl leading-none font-bold">{sweep.reference.unlocked}</p>
                <p className="text-lg font-semibold">units where offset hinges open every room, and the doors as scanned do not.</p>
                <p className="text-sm text-ink-soft">
                  {sweep.of ? `Of ${sweep.of} units in the sweep, ` : "From the sweep, "}for a {sweep.reference.chair[0]} × {sweep.reference.chair[1]} in chair; estimated from floor
                  plans, hinges add about 1.75 in (assumed).
                </p>
              </>
            ) : owner.total > 0 ? (
              <>
                <p className="display measure text-3xl leading-none font-bold">{owner.unlocked}</p>
                <p className="text-lg font-semibold">units where offset hinges open every room, and the doors as scanned do not.</p>
                <p className="text-base">
                  <span className="measure font-semibold">{owner.gained}</span> gain at least one room with hinges.
                </p>
                <p className="text-sm text-ink-soft">
                  Of {owner.total} ranked units, estimated from floor plans{owner.chair ? ` for a ${owner.chair[0]} × ${owner.chair[1]} in chair` : ""}; hinges add about
                  1.75 in (assumed).
                </p>
                {unitsReplay && <p className="text-sm font-semibold">Replay: counted from the synthetic example units, not real listings.</p>}
              </>
            ) : (
              <p className="text-base text-ink-soft">The ranked list is not loaded, so there is nothing to count yet.</p>
            )}
          </section>
        </div>

        <section aria-label="Everything else" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
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
    <section aria-label="Limitations and what is next" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-6 border border-rule-strong bg-paper-lift p-6">
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

/** Units with every room reachable against chair width: as scanned (solid) and with offset hinges (dashed), each labelled at its end. */
function SweepChart({ sweep }: { sweep: Sweep }) {
  // the viewBox is the figure's real width in CSS pixels, so the 16px labels render at 16px at any size
  const fig = useRef<HTMLElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = fig.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = Math.round(Math.min(300, Math.max(220, W * 0.4)));
  const pad = { l: 56, r: 120, t: 16, b: 44 };
  const pts = sweep.points;
  const x0 = pts[0].width;
  const x1 = pts[pts.length - 1].width;
  const top = Math.max(...pts.map((p) => Math.max(p.scanned, p.hinges)), 1);
  const step = top > 200 ? 100 : top > 40 ? 50 : 10;
  const yMax = Math.ceil(top / step) * step;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const line = (k: "scanned" | "hinges") => pts.map((p, i) => `${i ? "L" : "M"}${sx(p.width).toFixed(1)},${sy(p[k]).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const marks = [
    { at: 27, label: "27 in, the demo chair" },
    { at: 32, label: "32 in, ADA minimum door" },
  ].filter((m) => m.at >= x0 && m.at <= x1);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const end = sx(x1);
  // keep the two end labels apart when the lines finish close together
  let yScanned = sy(last.scanned);
  let yHinges = sy(last.hinges);
  if (Math.abs(yScanned - yHinges) < 20) [yHinges, yScanned] = [Math.min(yScanned, yHinges) - 10, Math.max(yScanned, yHinges) + 10];
  return (
    <figure ref={fig} className="flex flex-col gap-2">
      <p className="text-base">
        As scanned, every room is reachable in <span className="measure font-semibold">{first.scanned}</span> units for a{" "}
        <span className="measure font-semibold">{first.width} in</span> chair and in <span className="measure font-semibold">{last.scanned}</span> for a{" "}
        <span className="measure font-semibold">{last.width} in</span> chair.
      </p>
      <svg
        role="img"
        aria-label={`Units with every room reachable, by chair width, as scanned and with offset hinges: ${pts.map((p) => `${p.width} in, ${p.scanned} and ${p.hinges}`).join("; ")}`}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={end} y1={sy(t)} y2={sy(t)} stroke="var(--rule)" strokeWidth={1} />
            <text x={pad.l - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle" className="measure fill-[var(--ink-soft)] text-[16px]">
              {t}
            </text>
          </g>
        ))}
        {marks.map((m) => (
          <g key={m.at}>
            <line x1={sx(m.at)} x2={sx(m.at)} y1={pad.t} y2={H - pad.b} stroke="var(--rule-strong)" strokeDasharray="2 4" />
            <text x={sx(m.at) - 6} y={pad.t + 14} textAnchor="end" className="fill-[var(--ink-soft)] text-[16px]">
              {m.label}
            </text>
          </g>
        ))}
        <path d={line("hinges")} fill="none" stroke="var(--ink-soft)" strokeWidth={3} strokeDasharray="8 6" />
        <path d={line("scanned")} fill="none" stroke="var(--ink)" strokeWidth={3} />
        {pts.map((p) => (
          <circle key={p.width} cx={sx(p.width)} cy={sy(p.scanned)} r={4} fill="var(--ink)" />
        ))}
        <text x={end + 10} y={yHinges} dominantBaseline="middle" className="fill-[var(--ink-soft)] text-[16px]">
          with hinges
        </text>
        <text x={end + 10} y={yScanned} dominantBaseline="middle" className="fill-[var(--ink)] text-[16px] font-semibold">
          as scanned
        </text>
        {pts.map((p, i) =>
          i % Math.ceil(pts.length / 8) === 0 || i === pts.length - 1 ? (
            <text key={`x${p.width}`} x={sx(p.width)} y={H - pad.b + 24} textAnchor="middle" className={cn("measure fill-[var(--ink-soft)] text-[16px]")}>
              {p.width}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="text-sm text-ink-soft">
        Chair width (in) against units with every room reachable{sweep.of ? `, of ${sweep.of}` : ""}; a room the scan left unknown counts as not reached.
        Estimated from floor plans{sweep.lengthRule ? `; chair length follows width (assumed)` : ""}. From /api/insights. The 32 in door minimum is the 2010 ADA Standards, 404.2.3.
      </figcaption>
    </figure>
  );
}
