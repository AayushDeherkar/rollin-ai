"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import { countRooms } from "@/lib/contract";
import { useNoPlan, useUnitPair, useUnitsList } from "@/lib/data";
import { useAgentRun } from "@/lib/agent";
import type { Evidence } from "@/components/trace/timeline";
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
import { PlanStage } from "@/components/plan/plan-stage";
import { TourPanel } from "@/components/plan/tour-panel";
import { useDriveProgress } from "@/lib/drive-progress";

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

/** `?agent=replay` plays the recorded run instead of the live agent (labelled replay on screen). */
function readAgentReplay(): boolean {
  return new URLSearchParams(window.location.search).get("agent") === "replay";
}

/**
 * A stable id for this browser, sent as the profile's sender_id (contract v3) so the agent's
 * profile memory carries across runs from the same browser. Random; it identifies no one.
 */
function webSenderId(): string | undefined {
  try {
    const key = "rollin.sender";
    let id = localStorage.getItem(key);
    if (!id) {
      id = `web_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return undefined;
  }
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
  // and a live batch only has models cached for some units: the API's 404s are remembered
  const noPlan = useNoPlan();
  const hasPlan = (s: string) => !noPlan.includes(s) && (list.status !== "ready" || list.origin === "live" || fixtureUnit(s, false) !== null);

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
  const agent = useAgentRun();
  const [shownEvidence, setShownEvidence] = useState<string | null>(null);
  // a finding opens its evidence: its unit, in the scenario it was found under, with the chair driven to its room
  const showEvidence = useCallback((e: Evidence) => {
    setShownEvidence(e.eventId);
    setChosen(e.sid);
    setScenario(e.hinges ? "hinges" : "scanned");
    setPick({ sid: e.sid, room: e.roomId });
    setDriving(true);
    setRunId((n) => n + 1);
  }, []);

  // a door the chair cannot pass opens the unit's Matterport tour; only real scans have one
  const [tour, setTour] = useState<{ sid: string; edge: string } | null>(null);
  const hasTour = pair.status === "ready" && pair.origin === "live" && sid !== null && !sid.startsWith("synthetic");
  const openTour = useCallback((edge: string) => sid && setTour({ sid, edge }), [sid]);
  const closeTour = useCallback(() => setTour(null), []);
  const tourShown = tour && tour.sid === sid && hasTour ? tour : null;

  const onStart = useCallback(() => setDriving(true), []);
  const onSettled = useCallback(() => setDriving(false), []);
  // one drive, shared by the 3D model and the 2D plan
  const { progress, s: route } = useDriveProgress(drive, runId, onStart, onSettled);

  // the list follows the scenario: with offset hinges it shows and ranks by the API's with_hinges figures,
  // in the API's own order (score, then fewer blocked, then nearer, then id)
  const hingesOn = scenario === "hinges";
  const ranked = rows
    .map((r) => {
      const h = hingesOn && r.with_hinges ? r.with_hinges : null;
      // an older batch index has no hinges summary: show none rather than the as-scanned one
      return {
        r,
        score: h ? h.score : r.score,
        counts: h ? h.counts : r.counts,
        summary: h ? h.summary || null : r.summary,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.counts.blocked - b.counts.blocked ||
        (a.r.distance_km ?? 0) - (b.r.distance_km ?? 0) ||
        (a.r.sid < b.r.sid ? -1 : a.r.sid > b.r.sid ? 1 : 0), // code-point order, as Python sorts
    );
  const listItems: UnitListItem[] = ranked.map(({ r, counts, summary }, i) => ({
    sid: r.sid,
    rank: i + 1,
    name: r.name,
    counts,
    summary,
    distanceKm: r.distance_km ?? null,
    note: hasPlan(r.sid) ? null : noPlan.includes(r.sid) ? "No model cached" : "No plan in the replay",
  }));
  if (sid && !rows.some((r) => r.sid === sid) && entry) {
    const shown = hingesOn && entry.hinges ? entry.hinges : entry.asScanned;
    listItems.unshift({
      sid,
      rank: null,
      name: entry.asScanned.name,
      counts: countRooms(shown),
      summary: null,
      distanceKm: null,
      note: "Opened by id, not in the ranked list",
    });
  }
  const caption = rows.length
    ? `Ranked by share of rooms the chair reaches${hingesOn ? ", with offset hinges" : ", as scanned"}. Counts and distances are estimated.`
    : null;

  const listState: PanelState = preview ?? (list.status === "loading" ? "loading" : listItems.length ? "ready" : "empty");
  const planState: PanelState = preview ?? (pair.status === "loading" && sid ? "loading" : unit ? "ready" : "empty");
  const traceState: PanelState = preview ?? "ready";
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
            caption={caption}
            emptyNote={list.status === "error" ? `The unit list could not be loaded: ${list.message}` : null}
            onSelect={(next) => {
              // the unit already on the plan: nothing to load or drive
              if (next === sid) return;
              // the scenario stays: the list is ranked by it, so changing it here would re-sort under the cursor
              setChosen(next);
              setDriving(true);
            }}
          />
          <div className="flex min-h-0 border-x border-rule-strong">
            <PlanPanel
              state={planState}
              title={unit && unit.floors.length > 1 && floor ? `Plan, ${floor.floor}` : "Plan"}
              tag={planReplay !== null ? <ReplayTag reason={planReplay} /> : null}
              emptyNote={
                pair.status === "error"
                  ? {
                      title: "This plan could not be loaded",
                      body: pair.message,
                    }
                  : null
              }
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
                  <div className="relative min-h-0 flex-1">
                    {/* the tour replaces the model while open: two WebGL scenes would share the GPU */}
                    {tourShown ? (
                      <TourPanel
                        sid={tourShown.sid}
                        unitName={unit.name}
                        door={floor.doors.find((d) => d.edge === tourShown.edge) ?? null}
                        onClose={closeTour}
                      />
                    ) : (
                      <PlanStage
                        unit={unit}
                        floor={floor}
                        drive={drive}
                        driving={driving}
                        progress={progress}
                        s={route}
                        selectedRoom={target}
                        onRoomSelect={driveTo}
                        onDoorOpen={hasTour ? openTour : undefined}
                        renderPlan={(compact) => (
                          <FloorPlan
                            unit={unit}
                            compact={compact}
                            baseline={scenario === "hinges" ? entry?.asScanned : null}
                            selectedRoom={compact ? null : target}
                            onRoomSelect={compact ? undefined : driveTo}
                            onDoorOpen={hasTour ? openTour : undefined}
                            highlightDoor={drive?.kind === "blocked" && !driving ? (drive.door?.edge ?? null) : null}
                            overlay={({ projection }) =>
                              drive && <ChairLayer drive={drive} chairIn={unit.chair_in} projection={projection} progress={progress} s={route} />
                            }
                            annotations={({ projection, size, gutter }) =>
                              !compact &&
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
                        )}
                      />
                    )}
                  </div>
                  <PlanLegend unit={unit} floor={floor} />
                </div>
              )}
            </PlanPanel>
          </div>
          <TracePanel
            state={traceState}
            run={agent.run}
            decisions={agent.decisions}
            acting={agent.acting}
            defaultMessage="Find units near the Medical Center my 27 × 42 in chair can live in. Check bedroom and bathroom access."
            onRun={(message) => {
              setShownEvidence(null);
              agent.start(
                message,
                { sender_id: webSenderId(), chair_in: chair ? [chair[0], chair[1]] : null },
                { replay: readAgentReplay() },
              );
            }}
            onStop={agent.stop}
            onDecide={agent.decide}
            onEvidence={showEvidence}
            shownEvidence={shownEvidence}
          />
        </div>
        <TitleBlock
          cells={[
            { label: "Unit", value: unit ? unit.name : "None selected" },
            {
              label: "Chair (width × length)",
              value: chair ? `${chair[0].toFixed(1)} × ${chair[1].toFixed(1)} in` : "Not set",
              measure: true,
            },
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
