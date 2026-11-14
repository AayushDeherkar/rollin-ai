"use client";

/**
 * The guided stage at `/`: one full-screen 3D canvas behind everything, with the interface
 * floating over it (web/DESIGN.md, "The stage"). Three steps: Chair, Search, Apartment.
 * The three-panel layout stays at /classic, and is where the stage sends you if 3D cannot run.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { MotionConfig } from "motion/react";
import type * as THREE from "three";
import { PatternDefs } from "@/components/sheet/status";
import { readWebgl } from "@/components/plan/plan-stage";
import { PRESETS, type ChairIn, type Step } from "@/lib/stage";
import { useAgentRun } from "@/lib/agent";
import { useUnitsList } from "@/lib/data";
import { readSearch } from "@/lib/search";
import type { UnitRow } from "@/lib/contract";
import { readAgentReplay, webSenderId } from "@/components/workbench";
import { AgentPill, ApprovalFocus, BestFits, FieldLegend, Narration } from "./search-overlay";
import { FieldScene, unitPosition } from "./field-scene";
import { StepBar } from "./step-bar";
import { ChairPlate } from "./chair-plate";
import { ChairScene } from "./chair-scene";

const StageCanvas = dynamic(() => import("./stage-canvas").then((m) => m.StageCanvas), { ssr: false });

const noSubscribe = () => () => {};
const readForceReduce = () => new URLSearchParams(window.location.search).get("motion") === "reduce";

/** Send the viewer to the plain layout, saying why (shown there). */
export function fallBack(reason: string) {
  window.location.replace(`/classic?why=${encodeURIComponent(reason.slice(0, 160))}`);
}

export function StageApp() {
  const forceReduce = useSyncExternalStore(noSubscribe, readForceReduce, () => false);
  useEffect(() => {
    // CSS durations (tokens.css) follow the same switch
    if (forceReduce) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [forceReduce]);
  const webgl = useSyncExternalStore(noSubscribe, readWebgl, () => true);
  useEffect(() => {
    if (!webgl) fallBack("This browser cannot draw 3D (no WebGL)");
  }, [webgl]);
  // the stage reads the address on its first render, so it is drawn on the client only
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  return (
    <MotionConfig reducedMotion={forceReduce ? "always" : "user"}>
      {client && <Stage />}
    </MotionConfig>
  );
}

/**
 * Entry points for presenting and screenshots: `?search=1` starts the search with the default
 * chair on load; `?pace=N` sets a replay's speed (0 = at once). `?agent=replay` replays a recorded run.
 */
function readEntry() {
  const q = new URLSearchParams(window.location.search);
  const pace = q.get("pace");
  return { search: q.get("search") === "1", pace: pace !== null && Number.isFinite(Number(pace)) ? Number(pace) : undefined };
}

function Stage() {
  const [entry] = useState(readEntry);
  const [step, setStep] = useState<Step>(entry.search ? "search" : "chair");
  const [chair, setChair] = useState<ChairIn>(PRESETS[1].chair);
  /** the chair the search was started with: the profile sent to /api/chat */
  const [profile, setProfile] = useState<ChairIn | null>(entry.search ? PRESETS[1].chair : null);
  /** the unit the apartment step shows */
  const [sid, setSid] = useState<string | null>(null);
  const available: Record<Step, boolean> = { chair: true, search: profile !== null, apartment: sid !== null };

  const agent = useAgentRun();
  const startAgent = agent.start;
  const list = useUnitsList();
  const units: UnitRow[] = useMemo(() => (list.status === "ready" ? list.data.units : []), [list]);
  const origin = useMemo(() => (list.status === "ready" ? { lat: list.data.query.lat, lon: list.data.query.lon } : null), [list]);
  const view = useMemo(() => readSearch(agent.run, units), [agent.run, units]);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const search = useCallback(
    (c: ChairIn) =>
      startAgent(
        `Find units near the Medical Center my ${c[0]} × ${c[1]} in chair can live in. Check bedroom and bathroom access.`,
        { sender_id: webSenderId(), chair_in: [c[0], c[1]] },
        { replay: readAgentReplay(), pace: entry.pace },
      ),
    [startAgent, entry.pace],
  );
  const find = useCallback(() => {
    setProfile(chair);
    setStep("search");
    search(chair);
  }, [chair, search]);
  useEffect(() => {
    if (entry.search) search(PRESETS[1].chair);
    // once, on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const open = useCallback((next: string) => {
    setSid(next);
    setStep("apartment");
  }, []);
  const chosenPoint = useMemo(() => {
    const u = sid ? units.find((r) => r.sid === sid) : null;
    return u && origin ? unitPosition(u, origin) : null;
  }, [sid, units, origin]);

  const pose = useCallback(
    (out: { pos: THREE.Vector3; target: THREE.Vector3 }) => {
      if (step === "chair") {
        out.pos.set(2.2, 1.5, 2.6);
        out.target.set(-0.35, 0.45, 0);
      } else if (step === "apartment" && chosenPoint) {
        const [x, , z] = chosenPoint;
        out.pos.set(x + 9, 16, z + 13);
        out.target.set(x, 0, z);
      } else {
        // high over the medical center, the field filling the screen; a little off-centre
        // so the plates on the left and the cards on the right do not cover the middle
        out.pos.set(4, 92, 58);
        out.target.set(4, 0, -4);
      }
    },
    [step, chosenPoint],
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper">
      <PatternDefs />
      {/* isolate: the scene's labels stack inside the canvas layer, under every plate */}
      <div className="absolute inset-0 isolate">
        <StageCanvas pose={pose} onFallback={fallBack}>
          <ChairScene chair={step === "chair" ? chair : (profile ?? chair)} visible={step !== "apartment"} />
          {origin && (
            <FieldScene
              units={units}
              origin={origin}
              status={view.status}
              ranked={view.shortlist.map((u) => u.sid)}
              chosen={sid}
              mode={step === "search" ? "full" : step === "apartment" ? "chosen" : "hidden"}
              onPick={open}
            />
          )}
        </StageCanvas>
      </div>
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-6">
        <StepBar step={step} available={available} onStep={setStep} />
        {step === "search" && (
          <AgentPill
            run={agent.run}
            decisions={agent.decisions}
            acting={agent.acting}
            steps={view.steps}
            onDecide={agent.decide}
            onEvidence={(e) => open(e.sid)}
          />
        )}
      </header>
      {step === "chair" && (
        <div className="pointer-events-none absolute bottom-6 left-6">
          <ChairPlate chair={chair} onChair={setChair} onFind={find} />
        </div>
      )}
      {step === "search" && (
        <>
          <div className="pointer-events-none absolute top-28 right-6">
            <BestFits view={view} onOpen={open} />
          </div>
          <div className="pointer-events-none absolute bottom-6 left-6 flex flex-col items-start gap-3">
            <FieldLegend acting={agent.acting} />
            <Narration text={view.narration} acting={agent.acting} />
          </div>
          {view.approval && dismissed !== view.approval.action_id && (
            // left, under the step bar: the middle of the field stays visible
            <div className="pointer-events-none absolute top-28 left-6">
              <ApprovalFocus view={view} decisions={agent.decisions} onDecide={agent.decide} onDismiss={() => setDismissed(view.approval?.action_id ?? null)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
