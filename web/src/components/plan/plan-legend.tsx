import { Ban } from "lucide-react";
import type { Floor, RoomStatus, UnitResult } from "@/lib/contract";
import { STATUS, StatusIcon, StatusSwatch } from "@/components/sheet/status";

const ORDER: RoomStatus[] = ["reachable", "blocked", "unknown"];

/**
 * Key to the drawing: status fills, the dimension convention, and what is estimated.
 * Per-room reasons live in the room tooltips and in the callout for the room being driven to.
 */
export function PlanLegend({ unit, floor }: { unit: UnitResult; floor: Floor }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-rule-strong px-5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5" aria-label="Room status key">
          {ORDER.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <StatusSwatch status={s} />
              <StatusIcon status={s} />
              <span className={`font-semibold ${STATUS[s].text}`}>{STATUS[s].word}</span>
            </li>
          ))}
        </ul>
        <span className="flex items-center gap-2">
          <DimSample />
          door passes
        </span>
        <span className="flex items-center gap-2 text-block">
          <DimSample blocked />
          <Ban aria-hidden className="size-5" strokeWidth={2.5} />
          <span className="font-semibold">too narrow</span>
        </span>
        {floor.rooms.some((r) => r.turning_space?.center) && (
          <span className="flex items-center gap-2">
            <svg aria-hidden viewBox="0 0 20 20" className="size-5">
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--block)" strokeWidth="1.75" strokeDasharray="4 3" />
            </svg>
            60 in turning circle, walls only
          </span>
        )}
      </div>
      <p className="text-ink-soft">
        Door figures are clear width, <strong className="font-semibold text-ink">est.</strong> (opening minus about 5 cm)
        {unit.scenario !== "as scanned" ? "; hinge gain assumed" : ""}. Chair track: the engine’s route. <span className="measure">{floor.openings_found}</span> openings,{" "}
        <span className="measure">{floor.artifacts_ignored}</span> artifacts ignored.
      </p>
    </div>
  );
}

function DimSample({ blocked = false }: { blocked?: boolean }) {
  const c = blocked ? "var(--block)" : "var(--ink-soft)";
  return (
    <svg aria-hidden viewBox="0 0 44 16" className="h-4 w-11">
      <g stroke={c} strokeWidth="1.5">
        <line x1="4" y1="2" x2="4" y2="14" />
        <line x1="40" y1="2" x2="40" y2="14" />
        <line x1="4" y1="8" x2="40" y2="8" />
        <line x1="0" y1="12" x2="8" y2="4" strokeWidth="2" />
        <line x1="36" y1="12" x2="44" y2="4" strokeWidth="2" />
      </g>
    </svg>
  );
}
