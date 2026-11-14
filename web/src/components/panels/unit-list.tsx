"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import type { RoomStatus, StatusCounts } from "@/lib/contract";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EmptyNote, Panel, type PanelState } from "@/components/sheet/panel";
import { STATUS, StatusIcon } from "@/components/sheet/status";
import { ReplayTag } from "@/components/sheet/replay-tag";

export interface UnitListItem {
  sid: string;
  /** 1-based place in the ranking; null for a unit opened by id */
  rank: number | null;
  name: string;
  counts: StatusCounts;
  /** the API's one-line summary for this scenario */
  summary: string | null;
  distanceKm: number | null;
  /** a caveat under the name (e.g. why the unit is listed, or that the replay has no plan) */
  note: ReactNode;
}

const ORDER: RoomStatus[] = ["reachable", "blocked", "unknown"];

export function UnitList({
  state,
  items,
  selected,
  replayReason,
  emptyNote,
  caption,
  onSelect,
}: {
  state: PanelState;
  items: UnitListItem[];
  selected: string | null;
  /** set when the list is the replayed contract fixture */
  replayReason?: string | null;
  emptyNote?: string | null;
  /** what the ranking is by, shown above the rows */
  caption?: ReactNode;
  onSelect: (sid: string) => void;
}) {
  return (
    <Panel
      title="Units"
      labelledBy="units-heading"
      tag={state === "ready" && replayReason !== undefined && replayReason !== null ? <ReplayTag reason={replayReason} /> : null}
      aside={state === "ready" ? <span className="text-sm text-ink-soft">{items.length} found</span> : null}
    >
      {state === "loading" && <UnitListLoading />}
      {state === "empty" && emptyNote && <EmptyNote title="No units to show">{emptyNote}</EmptyNote>}
      {state === "empty" && !emptyNote && (
        <EmptyNote title="No units yet">
          Units appear here after a search. Each one is ranked by how many rooms your chair can reach.
        </EmptyNote>
      )}
      {state === "ready" && (
        <div className="flex h-full flex-col">
          {caption && <p className="shrink-0 border-b border-rule px-5 py-2.5 text-sm text-ink-soft">{caption}</p>}
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {items.map(({ sid, rank, name, counts, summary, distanceKm, note }) => {
              const isSelected = selected === sid;
              return (
                <motion.li key={sid} layout="position" transition={{ duration: DUR[3], ease: EASE_DRAFT }} className="border-b border-rule">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(sid)}
                    className={cn(
                      "relative grid w-full grid-cols-[2rem_minmax(0,1fr)] gap-x-1 py-4 pr-5 pl-3 text-left transition-colors transition-draft",
                      "hover:bg-paper-deep",
                      isSelected && "bg-paper-deep before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-ink",
                    )}
                  >
                    <span className="display pt-0.5 text-right text-xl leading-none font-semibold text-ink-soft" aria-label={rank ? `Rank ${rank}` : undefined}>
                      {rank ?? ""}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1.5 pl-2">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-lg leading-snug font-semibold">{name}</span>
                        {distanceKm != null && <span className="measure shrink-0 text-sm text-ink-soft">{distanceKm.toFixed(1)} km</span>}
                      </span>
                      {note && <span className="text-sm text-ink-soft">{note}</span>}
                      {summary && <span className="line-clamp-2 text-sm text-ink-soft">{summary}</span>}
                      <span className="flex gap-5" aria-label={ORDER.map((st) => `${counts[st]} ${STATUS[st].word.toLowerCase()}`).join(", ")}>
                        {ORDER.map((st) => (
                          <span key={st} className={cn("measure flex items-center gap-1.5 text-base font-medium", STATUS[st].text)}>
                            <StatusIcon status={st} />
                            {counts[st]}
                          </span>
                        ))}
                      </span>
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        </div>
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
