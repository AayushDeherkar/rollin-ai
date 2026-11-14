"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import { countRooms } from "@/lib/contract";
import { useUnitPair, useUnitsList } from "@/lib/data";
import { fixtureUnit } from "@/lib/fixtures";
import { buildDrive, defaultTarget } from "@/lib/chair";
import type { PanelState } from "@/components/sheet/panel";
import { PatternDefs } from "@/components/sheet/status";
import { TitleBlock } from "@/components/sheet/title-block";
import { UnitList, type UnitListItem } from "@/components/panels/unit-list";
import { ReplayTag } from "@/components/sheet/replay-tag";
import { PlanPanel } from "@/components/panels/plan-panel";
import { TracePanel } from "@/components/panels/trace-panel";
import { FloorPlan } from "@/components/plan/floor-plan";
import { PlanLegend } from "@/components/plan/plan-legend";
import { ChairLayer } from "@/components/plan/chair-layer";
import { ChairCallout } from "@/components/plan/chair-callout";
import { ScenarioToggle, type Scenario } from "@/components/plan/scenario-toggle";

type Preview = PanelState | null;

/** `?state=loading` or `?state=empty` previews every panel in that state (for design review). */
function readPreview(): Preview {
  const s = new URLSearchParams(window.location.search).get("state");
  return s === "loading" || s === "empty" ? s : null;
}
const noSubscribe = () => () => {};

function usePreviewState(): Preview {
  return useSyncExternalStore(noSubscribe, readPreview, () => null);
}

/** `?sid=<model id>` opens one unit by id, whether or not it is in the ranked list. */
function readForcedSid(): string | null {
  const s = new URLSearchParams(window.location.search).get("sid");
  return s && /^[A-Za-z0-9_]{3,40}$/.test(s) ? s : null;
}
function useForcedSid(): string | null {
  return useSyncExternalStore(noSubscribe, readForcedSid, () => null);
}

/**
 * `?motion=reduce` runs the app as if the OS asked for reduced motion (to check that path
 * on a machine without the setting, or to present without animation). Otherwise the OS decides.
 */
function readForceReduce(): boolean {
  return new URLSearchParams(window.location.search).get("motion") === "reduce";
}
function useForceReduce(): boolean {
  return useSyncExternalStore(noSubscribe, readForceReduce, () => false);
}

export function Workbench() {
  const forceReduce = useForceReduce();
  useEffect(() => {
    // CSS durations (tokens.css) follow the same switch
    if (forceReduce) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [forceReduce]);
  return (
    <MotionConfig reducedMotion={forceReduce ? "always" : "user"}>
      <Sheet />
    </MotionConfig>
  );
}

function Sheet() {
  const preview = usePreviewState();
  const forcedSid = useForcedSid();
  const list = useUnitsList();
  const rows = list.status === "ready" ? list.data.units : [];
  // a replayed list only has plans for the units the contract fixtures ship
  const hasPlan = (s: string) => list.status !== "ready" || list.origin === "live" || fixtureUnit(s, false) !== null;

  const [chosen, setChosen] = useState<string | null>(null);
  const sid = chosen ?? forcedSid ?? (rows.find((r) => hasPlan(r.sid)) ?? rows[0])?.sid ?? null;
  const pair = useUnitPair(sid);
  const entry = pair.status === "ready" ? pair.data : null;

  const [scenario, setScenario] = useState<Scenario>("scanned");
  const unit = entry ? (scenario === "hinges" && entry.hinges ? entry.hinges : entry.asScanned) : null;
  const floor = unit?.floors[0] ?? null;

  // the room the chair heads for: picked by the user for this unit, else the unit's default
  const [pick, setPick] = useState<{ sid: string; room: string } | null>(null);
  const target = pick && pick.sid === sid ? pick.room : entry ? defaultTarget(entry.asScanned.floors[0]) : null;
  const [runId, setRunId] = useState(0);
  const [glideRunning, setDriving] = useState(true);

  const drive = useMemo(() => (unit && floor && target ? buildDrive(unit, floor, target) : null), [unit, floor, target]);
  // with no drive there is no chair layer to report back, so nothing is driving
  const driving = glideRunning && drive != null;

  // Re-drive only when the outcome changes (e.g. a room turns reachable with hinges);
  // if the chair still stops at the same door it stays put and the figures update in place.
  const lastKind = useRef(drive?.kind);
  useEffect(() => {
    if (lastKind.current === drive?.kind) return;
    lastKind.current = drive?.kind;
    setDriving(true);
    setRunId((n) => n + 1);
  }, [drive?.kind]);

  const driveTo = useCallback(
    (roomId: string) => {
      if (!sid) return;
      setPick({ sid, room: roomId });
      setDriving(true);
      setRunId((n) => n + 1);
    },
    [sid],
  );
  const onStart = useCallback(() => setDriving(true), []);
  const onSettled = useCallback(() => setDriving(false), []);

  const listItems: UnitListItem[] = rows.map((r) => ({
    sid: r.sid,
    name: r.name,
    counts: r.counts,
    note: hasPlan(r.sid) ? null : "No plan in the replay",
  }));
  if (sid && !rows.some((r) => r.sid === sid) && entry) {
    listItems.unshift({ sid, name: entry.asScanned.name, counts: countRooms(entry.asScanned), note: "Opened by id, not in the ranked list" });
  }

  const listState: PanelState = preview ?? (list.status === "loading" ? "loading" : listItems.length ? "ready" : "empty");
  const planState: PanelState = preview ?? (pair.status === "loading" && sid ? "loading" : unit ? "ready" : "empty");
  const traceState: PanelState = preview ?? "empty";
  const chair = unit?.chair_in ?? (list.status === "ready" ? ([list.data.query.w, list.data.query.l] as const) : null);
  const listReplay = list.status === "ready" && list.origin === "replay" ? list.reason : null;
  const planReplay = pair.status === "ready" && pair.origin === "replay" ? pair.reason : null;

  return (
    <div className="flex h-full flex-col p-3">
      <PatternDefs />
      {/* the sheet: heavy outer frame, hairline inner frame */}
      <main className="flex min-h-0 flex-1 flex-col border-2 border-ink p-1">
        <div className="grid min-h-0 flex-1 grid-cols-[var(--panel-left)_minmax(0,1fr)_var(--panel-right)] border border-rule-strong">
          <UnitList
            state={listState}
            items={listItems}
            selected={sid}
            replayReason={listReplay}
            emptyNote={list.status === "error" ? `The unit list could not be loaded: ${list.message}` : null}
            onSelect={(next) => {
              // the unit already on the plan: nothing to load or drive
              if (next === sid) return;
              setChosen(next);
              setScenario("scanned");
              setDriving(true);
            }}
          />
          <div className="flex min-h-0 border-x border-rule-strong">
            <PlanPanel
              state={planState}
              title={unit && unit.floors.length > 1 && floor ? `Plan, ${floor.floor}` : "Plan"}
              tag={planReplay !== null ? <ReplayTag reason={planReplay} /> : null}
              emptyNote={pair.status === "error" ? { title: "This plan could not be loaded", body: pair.message } : null}
              className="flex-1"
              aside={
                unit && (
                  <div className="flex items-center gap-3">
                    <div className="flex w-64 justify-end">
                      {driving ? (
                        <span role="status" className="flex items-center gap-2 text-sm font-semibold text-agent">
                          <span className="size-2.5 rounded-full bg-agent motion-safe:animate-pulse" />
                          Driving to the {drive?.room.label.toLowerCase() ?? "room"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => target && driveTo(target)}
                          className="flex h-10 items-center gap-2 border border-rule-strong px-3 text-sm font-semibold transition-colors transition-draft hover:bg-paper-deep"
                        >
                          <RotateCcw aria-hidden className="size-4" strokeWidth={2.25} />
                          Drive again
                        </button>
                      )}
                    </div>
                    <ScenarioToggle value={scenario} onChange={setScenario} disabled={!entry?.hinges} />
                  </div>
                )
              }
            >
              {unit && floor && (
                <div className="flex h-full flex-col">
                  <div className="min-h-0 flex-1">
                    <FloorPlan
                      unit={unit}
                      baseline={scenario === "hinges" ? entry?.asScanned : null}
                      selectedRoom={target}
                      onRoomSelect={driveTo}
                      highlightDoor={drive?.kind === "blocked" && !driving ? (drive.door?.edge ?? null) : null}
                      overlay={({ projection }) =>
                        drive && (
                          <ChairLayer
                            key={`${unit.model}:${target}`}
                            drive={drive}
                            chairIn={unit.chair_in}
                            projection={projection}
                            runId={runId}
                            onStart={onStart}
                            onSettled={onSettled}
                          />
                        )
                      }
                      annotations={({ projection, size, gutter }) =>
                        drive &&
                        !driving && (
                          <ChairCallout
                            drive={drive}
                            floor={floor}
                            chairIn={unit.chair_in}
                            projection={projection}
                            size={size}
                            gutter={gutter}
                            scenario={unit.scenario}
                          />
                        )
                      }
                    />
                  </div>
                  <PlanLegend unit={unit} floor={floor} />
                </div>
              )}
            </PlanPanel>
          </div>
          <TracePanel state={traceState} />
        </div>
        <TitleBlock
          cells={[
            { label: "Unit", value: unit ? unit.name : "None selected" },
            { label: "Chair (width × length)", value: chair ? `${chair[0].toFixed(1)} × ${chair[1].toFixed(1)} in` : "Not set", measure: true },
            { label: "Scenario", value: unit ? unit.scenario : "None" },
            {
              label: "Data",
              // the plan on screen decides; with no plan, the list does
              value:
                pair.status === "ready" ? (
                  planReplay !== null ? (
                    <span title={planReplay}>Replay: synthetic contract fixture</span>
                  ) : (
                    "Rollin’ API, live"
                  )
                ) : listReplay !== null ? (
                  <span title={listReplay}>Replay: synthetic contract fixture</span>
                ) : list.status === "ready" ? (
                  "Rollin’ API, live"
                ) : (
                  "Loading"
                ),
            },
          ]}
        />
      </main>
    </div>
  );
}
