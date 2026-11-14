"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import type { UnitResult } from "@/lib/contract";
import { FIXTURE_LABEL, fixtureAsScanned, fixtureHinges } from "@/lib/fixtures";
import { buildDrive, defaultTarget } from "@/lib/chair";
import type { PanelState } from "@/components/sheet/panel";
import { PatternDefs } from "@/components/sheet/status";
import { TitleBlock } from "@/components/sheet/title-block";
import { UnitList, type UnitListItem } from "@/components/panels/unit-list";
import { PlanPanel } from "@/components/panels/plan-panel";
import { TracePanel } from "@/components/panels/trace-panel";
import { FloorPlan } from "@/components/plan/floor-plan";
import { PlanLegend } from "@/components/plan/plan-legend";
import { ChairLayer } from "@/components/plan/chair-layer";
import { ChairCallout } from "@/components/plan/chair-callout";
import { ScenarioToggle, type Scenario } from "@/components/plan/scenario-toggle";

interface UnitEntry {
  asScanned: UnitResult;
  hinges: UnitResult | null;
  source: string;
}

const UNITS: UnitEntry[] = [{ asScanned: fixtureAsScanned, hinges: fixtureHinges, source: FIXTURE_LABEL }];

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

export function Workbench() {
  const preview = usePreviewState();
  const [selected, setSelected] = useState<string | null>(UNITS[0]?.asScanned.model ?? null);
  const [scenario, setScenario] = useState<Scenario>("scanned");
  const entry = UNITS.find((u) => u.asScanned.model === selected) ?? null;
  const unit = entry ? (scenario === "hinges" && entry.hinges ? entry.hinges : entry.asScanned) : null;
  const floor = unit?.floors[0] ?? null;

  const [target, setTarget] = useState<string | null>(() => (entry ? defaultTarget(entry.asScanned.floors[0]) : null));
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

  const driveTo = useCallback((roomId: string) => {
    setTarget(roomId);
    setDriving(true);
    setRunId((n) => n + 1);
  }, []);
  const onStart = useCallback(() => setDriving(true), []);
  const onSettled = useCallback(() => setDriving(false), []);

  const listState: PanelState = preview ?? "ready";
  const planState: PanelState = preview ?? (unit ? "ready" : "empty");
  const traceState: PanelState = preview ?? "empty";
  const [w, l] = (unit ?? fixtureAsScanned).chair_in;
  const listItems: UnitListItem[] = UNITS.map((u) => ({
    unit: u.asScanned.model === selected && unit ? unit : u.asScanned,
    source: u.source,
  }));

  return (
    <div className="flex h-full flex-col p-3">
      <PatternDefs />
      {/* the sheet: heavy outer frame, hairline inner frame */}
      <main className="flex min-h-0 flex-1 flex-col border-2 border-ink p-1">
        <div className="grid min-h-0 flex-1 grid-cols-[var(--panel-left)_minmax(0,1fr)_var(--panel-right)] border border-rule-strong">
          <UnitList
            state={listState}
            items={listItems}
            selected={selected}
            onSelect={(m) => {
              setSelected(m);
              const e = UNITS.find((u) => u.asScanned.model === m);
              const t = e ? defaultTarget(e.asScanned.floors[0]) : null;
              if (t) driveTo(t);
            }}
          />
          <div className="flex min-h-0 border-x border-rule-strong">
            <PlanPanel
              state={planState}
              title={unit && unit.floors.length > 1 && floor ? `Plan, ${floor.floor}` : "Plan"}
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
            { label: "Chair (width × length)", value: `${w.toFixed(1)} × ${l.toFixed(1)} in`, measure: true },
            { label: "Scenario", value: unit ? unit.scenario : "None" },
            { label: "Data", value: unit ? FIXTURE_LABEL : "Contract fixtures only" },
          ]}
        />
      </main>
    </div>
  );
}
