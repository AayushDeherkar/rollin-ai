"use client";

import { countRooms, type RoomStatus, type UnitResult } from "@/lib/contract";
import { cn } from "@/lib/utils";
import { EmptyNote, Panel, type PanelState } from "@/components/sheet/panel";
import { STATUS, StatusIcon } from "@/components/sheet/status";

export interface UnitListItem {
  unit: UnitResult;
  source: string;
}

const ORDER: RoomStatus[] = ["reachable", "blocked", "unknown"];

export function UnitList({
  state,
  items,
  selected,
  onSelect,
}: {
  state: PanelState;
  items: UnitListItem[];
  selected: string | null;
  onSelect: (model: string) => void;
}) {
  return (
    <Panel title="Units" labelledBy="units-heading" aside={state === "ready" ? <span className="text-sm text-ink-soft">{items.length} found</span> : null}>
      {state === "loading" && <UnitListLoading />}
      {state === "empty" && (
        <EmptyNote title="No units yet">
          Units appear here after a search. Each one is ranked by how many rooms your chair can reach.
        </EmptyNote>
      )}
      {state === "ready" && (
        <ul className="h-full overflow-y-auto">
          {items.map(({ unit, source }) => {
            const counts = countRooms(unit);
            const isSelected = selected === unit.model;
            return (
              <li key={unit.model} className="border-b border-rule">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(unit.model)}
                  className={cn(
                    "relative flex w-full flex-col gap-2 py-4 pr-5 pl-6 text-left transition-colors transition-draft",
                    "hover:bg-paper-deep",
                    isSelected && "bg-paper-deep before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-ink",
                  )}
                >
                  <span className="text-lg font-semibold">{unit.name}</span>
                  <span className="text-sm text-ink-soft">{source}</span>
                  <span className="flex gap-5" aria-label={ORDER.map((s) => `${counts[s]} ${STATUS[s].word.toLowerCase()}`).join(", ")}>
                    {ORDER.map((s) => (
                      <span key={s} className={cn("measure flex items-center gap-1.5 text-base font-medium", STATUS[s].text)}>
                        <StatusIcon status={s} />
                        {counts[s]}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function UnitListLoading() {
  return (
    <ul aria-busy="true" aria-label="Loading units" className="h-full">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex flex-col gap-3 border-b border-rule py-5 pr-5 pl-6">
          <span className="h-5 w-3/4 bg-paper-deep motion-safe:animate-pulse" />
          <span className="h-4 w-1/2 bg-paper-deep motion-safe:animate-pulse" />
          <span className="flex gap-5">
            {ORDER.map((s) => (
              <span key={s} className="h-4 w-8 bg-paper-deep motion-safe:animate-pulse" />
            ))}
          </span>
        </li>
      ))}
      <li className="px-6 pt-4 text-sm text-ink-soft">Ranking units for your chair…</li>
    </ul>
  );
}
