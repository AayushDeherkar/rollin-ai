import { Ban } from "lucide-react";
import type { Floor, RoomStatus, UnitResult } from "@/lib/contract";
import { STATUS, StatusIcon, StatusSwatch } from "@/components/sheet/status";

const ORDER: RoomStatus[] = ["reachable", "blocked", "unknown"];

/** Key to the drawing: status fills, the dimension convention, and what is estimated. */
export function PlanLegend({ unit, floor }: { unit: UnitResult; floor: Floor }) {
  const notes = floor.rooms.filter((r) => r.reason || r.turning_space);
  return (
    <div className="flex flex-col gap-2 border-t border-rule-strong px-5 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Room status key">
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
      </div>
      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Room notes">
          {notes.map((r) => (
            <li key={r.room_id} className="flex gap-2">
              <StatusIcon status={r.status} />
              <span>
                <span className="font-semibold">{r.label}:</span> {r.reason ?? STATUS[r.status].word.toLowerCase()}
                {r.turning_space && (
                  <>
                    {r.reason ? ". " : "; "}Turning circle <span className="measure">{r.turning_space.max_circle_in.toFixed(1)} in</span>,{" "}
                    {r.turning_space.meets_60in ? "meets" : "under"} the 60 in needed (walls only)
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-soft">
        Door figures are clear width, <strong className="font-semibold text-ink">est.</strong> from the opening minus about 5 cm
        {unit.scenario !== "as scanned" ? "; hinge gain is assumed, not measured" : ""}.{" "}
        <span className="measure">{floor.openings_found}</span> openings found,{" "}
        <span className="measure">{floor.artifacts_ignored}</span> scan artifacts ignored.
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
