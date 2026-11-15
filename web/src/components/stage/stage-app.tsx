"use client";

/**
 * The guided stage at `/`: one full-screen 3D canvas behind everything, with the interface
 * floating over it (web/DESIGN.md, "The stage"). Three steps: Chair, Search, Apartment.
 * The three-panel layout stays at /classic, and is where the stage sends you if 3D cannot run.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { MotionConfig } from "motion/react";
import * as THREE from "three";
import { PatternDefs } from "@/components/sheet/status";
import { readWebgl } from "@/components/plan/plan-stage";
import { PRESETS, type ChairIn, type Step } from "@/lib/stage";
import { useAgentRun } from "@/lib/agent";
import { useUnitPair, useUnitsList } from "@/lib/data";
import { buildDrive, defaultTarget } from "@/lib/chair";
import { useDriveProgress } from "@/lib/drive-progress";
import { floorBounds } from "@/lib/plan-geometry";
import { isSynthetic, roomFrame, verdict, type VisionResult } from "@/lib/apartment";
import type { Floor } from "@/lib/contract";
import { readSearch } from "@/lib/search";
import type { UnitRow } from "@/lib/contract";
import { readAgentReplay, webSenderId } from "@/components/workbench";
import { AgentPill, ApprovalFocus, BestFits, FieldLegend, Narration } from "./search-overlay";
import { FieldScene, unitPosition } from "./field-scene";
import { ApartmentScene, modelCentre, modelToWorld } from "./apartment-scene";
import { ApartmentLegend, EvidencePanel, RoomCard, RoomStrip, VerdictLine, type EvidenceKind } from "./apartment-overlay";
import type { PoseGoal } from "./stage-canvas";
import { StepBar } from "./step-bar";
import { PublicBadge } from "@/components/public-badge";
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
  const sid = q.get("sid");
  return {
    search: q.get("search") === "1",
    pace: pace !== null && Number.isFinite(Number(pace)) ? Number(pace) : undefined,
    /** `?sid=<model id>` opens step 3 on that unit */
    sid: sid && /^[A-Za-z0-9_]{3,40}$/.test(sid) ? sid : null,
    /** `?demo=1`: presenter mode. Step 3 on the demo unit, the chair already stopped at the bedroom door; R resets */
    demo: q.get("demo") === "1",
  };
}

/** The room the chair heads for first: a blocked bedroom the engine names a door for, else the engine's default. */
function firstRoom(floor: Floor): string | null {
  const bed = floor.rooms.find((r) => r.status === "blocked" && /bed/i.test(r.label) && r.blocking_door_edge && r.path?.length);
  return bed?.room_id ?? defaultTarget(floor);
}

/** `?sid=` units the list does not carry stand at the medical center */
const ORIGIN: [number, number, number] = [0, 0, 0];

function Stage() {
  const [entry] = useState(readEntry);
  const [step, setStep] = useState<Step>(entry.sid || entry.demo ? "apartment" : entry.search ? "search" : "chair");
  const [chair, setChair] = useState<ChairIn>(PRESETS[1].chair);
  /** the chair the search was started with: the profile sent to /api/chat */
  const [profile, setProfile] = useState<ChairIn | null>(entry.search ? PRESETS[1].chair : null);
  /** the unit the apartment step shows */
  const [sid, setSid] = useState<string | null>(entry.sid);
  const available: Record<Step, boolean> = { chair: true, search: profile !== null, apartment: sid !== null };

  const agent = useAgentRun();
  const startAgent = agent.start;
  const list = useUnitsList();
  const units: UnitRow[] = useMemo(() => (list.status === "ready" ? list.data.units : []), [list]);
  const origin = useMemo(() => (list.status === "ready" ? { lat: list.data.query.lat, lon: list.data.query.lon } : null), [list]);
  const view = useMemo(() => readSearch(agent.run, units), [agent.run, units]);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const search = useCallback(
    (c: ChairIn) => {
      startAgent(
        `Find units near the Medical Center my ${c[0]} × ${c[1]} in chair can live in. Check bedroom and bathroom access.`,
        { sender_id: webSenderId(), chair_in: [c[0], c[1]] },
        { replay: readAgentReplay(), pace: entry.pace },
      );
    },
    [startAgent, entry.pace],
  );
  const find = useCallback(() => {
    // a new run asks afresh, even if a replay reuses the last run's action id
    setDismissed(null);
    setProfile(chair);
    setStep("search");
    search(chair);
  }, [chair, search]);
  useEffect(() => {
    if (entry.search) search(PRESETS[1].chair);
    // once, on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chosenPoint = useMemo(() => {
    const u = sid ? units.find((r) => r.sid === sid) : null;
    return u && origin ? unitPosition(u, origin) : null;
  }, [sid, units, origin]);
  const at = chosenPoint ?? ORIGIN;

  // ── step 3: the apartment ──
  const pair = useUnitPair(sid);
  const both = pair.status === "ready" ? pair.data : null;
  const [hinges, setHinges] = useState(false);
  const unit = both ? (hinges && both.hinges ? both.hinges : both.asScanned) : null;
  const floor = unit?.floors[0] ?? null;
  const scannedFloor = both?.asScanned.floors[0] ?? null;
  const hingesFloor = both?.hinges?.floors[0] ?? null;
  /** the room the user picked (camera flies there); before that, the chair heads for the first room */
  const [pick, setPick] = useState<{ sid: string; room: string } | null>(null);
  const picked = pick && pick.sid === sid ? pick.room : null;
  const target = picked ?? (scannedFloor ? firstRoom(scannedFloor) : null);
  const [runId, setRunId] = useState(0);
  const [glide, setGlide] = useState(true);
  const [ride, setRide] = useState(false);
  const drive = useMemo(() => (unit && floor && target ? buildDrive(unit, floor, target) : null), [unit, floor, target]);
  const driving = glide && drive != null;
  const lastKind = useRef(drive?.kind);
  useEffect(() => {
    // re-drive when the outcome changes (a room turns reachable with hinges): the chair rolls in
    if (lastKind.current === drive?.kind) return;
    lastKind.current = drive?.kind;
    setGlide(true);
    setRunId((n) => n + 1);
  }, [drive?.kind]);
  const onStart = useCallback(() => setGlide(true), []);
  const onSettled = useCallback(() => setGlide(false), []);
  /** presenter mode's set view: the chair is placed at the end of its drive and the camera is put on the door, no flight */
  const [still, setStill] = useState(entry.demo);
  const { progress, s: route } = useDriveProgress(drive, runId, onStart, onSettled, still);
  // the door the ruler measures: where the chair stops as scanned, kept when hinges are tried
  const rulerEdge = useMemo(() => {
    if (!both || !scannedFloor || !target) return null;
    const d = buildDrive(both.asScanned, scannedFloor, target);
    return d?.kind === "blocked" ? (d.door?.edge ?? null) : null;
  }, [both, scannedFloor, target]);
  const live = pair.status === "ready" && pair.origin === "live" && unit !== null && !isSynthetic(unit);
  const [evidence, setEvidence] = useState<EvidenceKind | null>(null);
  /** the door the tour is about: the one clicked in the model, or the ruler's door when opened from the card */
  const [tourEdge, setTourEdge] = useState<string | null>(null);
  const showEvidence = useCallback(
    (kind: EvidenceKind | null) => {
      if (kind === "tour") setTourEdge(rulerEdge);
      setEvidence(kind);
    },
    [rulerEdge],
  );
  const [vision, setVision] = useState<VisionResult | null>(null);
  useEffect(() => {
    if (!sid || !live) return;
    const ac = new AbortController();
    fetch(`/api/vision/${encodeURIComponent(sid)}`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<VisionResult>) : null))
      .then((v) => !ac.signal.aborted && setVision(v))
      .catch(() => {});
    return () => ac.abort();
  }, [sid, live]);
  const photoFor = (roomId: string | null) => (vision && vision.sid === sid && roomId ? (vision.items.find((i) => i.room_id === roomId) ?? null) : null);

  const open = useCallback((next: string) => {
    setSid(next);
    setStep("apartment");
    setStill(false);
    setHinges(false);
    setRide(false);
    setEvidence(null);
    setGlide(true);
    setRunId((n) => n + 1);
  }, []);
  const selectRoom = useCallback(
    (roomId: string) => {
      if (!sid) return;
      setPick({ sid, room: roomId });
      setStill(false);
      setEvidence(null);
      setRide(false);
      setGlide(true);
      setRunId((n) => n + 1);
    },
    [sid],
  );
  const toggleRide = useCallback(() => {
    setStill(false);
    setRide((r) => !r);
    setGlide(true);
    setRunId((n) => n + 1);
  }, []);

  const toggleHinges = useCallback((on: boolean) => {
    setStill(false);
    setHinges(on);
  }, []);

  // ── presenter mode ──
  /** the unit presenter mode opens on (from /api/demo) */
  const [demoSid, setDemoSid] = useState<string | null>(null);
  /** back to the opening view: demo unit, bedroom, as scanned, chair stopped at the door */
  const reset = useCallback(() => {
    if (demoSid) setSid(demoSid);
    setStep("apartment");
    setPick(null);
    setHinges(false);
    setRide(false);
    setEvidence(null);
    setGlide(true);
    setStill(true);
    setRunId((n) => n + 1);
  }, [demoSid]);
  useEffect(() => {
    if (!entry.demo) return;
    const ac = new AbortController();
    fetch("/api/demo", { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ sid?: unknown }>) : null))
      .then((d) => {
        if (ac.signal.aborted || typeof d?.sid !== "string") return;
        setDemoSid(d.sid);
        setSid(d.sid);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [entry.demo]);
  useEffect(() => {
    if (!entry.demo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "r" && e.key !== "R") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry.demo, reset]);

  const scratch = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3() });
  const pose = useCallback(
    (out: PoseGoal) => {
      if (step === "chair") {
        out.pos.set(2.2, 1.5, 2.6);
        out.target.set(-0.35, 0.45, 0);
      } else if (step === "apartment") {
        const [x, , z] = at;
        if (!floor) {
          out.pos.set(x + 9, 16, z + 13);
          out.target.set(x, 0, z);
          return;
        }
        const c = modelCentre(floor);
        const b = floorBounds(floor);
        const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 4);
        if (ride && drive) {
          // a close chase view: behind the chair and above the walls (2.4 m), looking down past it about a
          // metre along the path, so the chair stays in view and no wall stands between; into the room once arrived
          const p = progress.get();
          const [cx, cy] = route.at(p);
          const ahead = route.length > 0 ? 0.9 / route.length : 1;
          const [ax, ay] = route.at(Math.min(1, p + ahead));
          let dx = ax - cx;
          let dy = ay - cy;
          if (Math.hypot(dx, dy) < 0.15) {
            // at the end of the path, or turning in place: face the middle of the room it heads for
            const f = roomFrame(drive.room);
            [dx, dy] = [f.centre[0] - cx, f.centre[1] - cy];
          }
          if (Math.hypot(dx, dy) < 0.15) {
            const [bx, by] = route.at(Math.max(0, p - ahead));
            [dx, dy] = [cx - bx, cy - by];
          }
          const n = Math.hypot(dx, dy) || 1;
          const [wx, , wz] = modelToWorld(at, c, [cx, cy]);
          const fx = dx / n;
          const fz = -dy / n;
          out.pos.set(wx - fx * 1.8, 3.4, wz - fz * 1.8);
          out.target.set(wx + fx * 0.8, 0.4, wz + fz * 0.8);
          out.rate = 4;
          out.fov = 55;
          return;
        }
        const { a } = scratch.current;
        const rulerDoor = rulerEdge ? floor.doors.find((d) => d.edge === rulerEdge) : null;
        if (!driving && rulerDoor) {
          // the chair has stopped at a door (or rolled through it with hinges): close in on the door and its ruler
          a.set(...modelToWorld(at, c, rulerDoor.center, 0.6));
          out.target.copy(a);
          out.pos.set(a.x + 3.2, 8.5, a.z + 5.5);
          if (still) out.snap = true;
          return;
        }
        const room = picked ? floor.rooms.find((r) => r.room_id === picked) : null;
        if (room) {
          const f = roomFrame(room);
          const k = Math.max(1, f.size / 3);
          a.set(...modelToWorld(at, c, f.centre));
          out.target.copy(a);
          out.pos.set(a.x + 3 * k, 8 * k, a.z + 5 * k);
          return;
        }
        out.pos.set(x + span * 0.5, span * 0.95, z + span * 0.8);
        out.target.set(x, 0, z);
      } else {
        // high over the medical center, the field filling the screen; a little off-centre
        // so the plates on the left and the cards on the right do not cover the middle
        out.pos.set(4, 92, 58);
        out.target.set(4, 0, -4);
      }
    },
    [step, at, floor, ride, drive, driving, picked, progress, route, rulerEdge, still],
  );

  return (
    <div className="fixed inset-0 overflow-clip bg-paper">
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
              mode={step === "search" ? "full" : "hidden"}
              onPick={open}
            />
          )}
          {unit && floor && (
            <ApartmentScene
              at={at}
              shown={step === "apartment"}
              ruler={driving || ride ? null : rulerEdge}
              unit={unit}
              floor={floor}
              drive={drive}
              driving={driving}
              progress={progress}
              s={route}
              selectedRoom={target}
              onRoomSelect={selectRoom}
              onDoorOpen={
                live
                  ? (edge: string) => {
                      setTourEdge(edge);
                      setEvidence("tour");
                    }
                  : undefined
              }
            />
          )}
        </StageCanvas>
      </div>
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-6">
        <div className="flex items-center gap-3">
          <StepBar step={step} available={available} onStep={setStep} />
          <PublicBadge />
        </div>
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
      {step === "apartment" && (
        <Apartment
          sid={sid}
          pair={pair}
          unit={unit}
          scannedFloor={scannedFloor}
          hingesFloor={hingesFloor}
          hinges={hinges}
          target={target}
          picked={picked}
          drive={drive}
          ride={ride}
          live={live}
          evidence={evidence}
          photoFor={photoFor}
          rulerEdge={rulerEdge}
          tourEdge={tourEdge}
          onRoom={selectRoom}
          onHinges={toggleHinges}
          onRide={toggleRide}
          onEvidence={showEvidence}
        />
      )}
    </div>
  );
}

function Apartment({
  sid,
  pair,
  unit,
  scannedFloor,
  hingesFloor,
  hinges,
  target,
  picked,
  drive,
  ride,
  live,
  evidence,
  photoFor,
  rulerEdge,
  tourEdge,
  onRoom,
  onHinges,
  onRide,
  onEvidence,
}: {
  sid: string | null;
  pair: ReturnType<typeof useUnitPair>;
  unit: import("@/lib/contract").UnitResult | null;
  scannedFloor: Floor | null;
  hingesFloor: Floor | null;
  hinges: boolean;
  target: string | null;
  picked: string | null;
  drive: ReturnType<typeof buildDrive>;
  ride: boolean;
  live: boolean;
  evidence: EvidenceKind | null;
  photoFor: (roomId: string | null) => import("@/lib/apartment").VisionItem | null;
  rulerEdge: string | null;
  /** the door the open tour is about */
  tourEdge: string | null;
  onRoom: (id: string) => void;
  onHinges: (on: boolean) => void;
  onRide: () => void;
  onEvidence: (k: EvidenceKind | null) => void;
}) {
  if (pair.status === "error") {
    return (
      <div className="pointer-events-none absolute top-28 left-6">
        <p role="alert" className="pointer-events-auto max-w-[56ch] border border-rule-strong bg-paper-lift px-5 py-3 text-base">
          This apartment’s plan could not be loaded: {pair.message}. Go back to Search and open another.
        </p>
      </div>
    );
  }
  if (!unit || !scannedFloor || !sid) {
    return (
      <p role="status" className="pointer-events-none absolute top-28 left-6 border border-rule-strong bg-paper-lift px-5 py-3 text-base">
        Building the apartment…
      </p>
    );
  }
  const v = verdict(scannedFloor, hingesFloor, hinges);
  const room = scannedFloor.rooms.find((r) => r.room_id === target) ?? null;
  const hingesRoom = room ? (hingesFloor?.rooms.find((r) => r.room_id === room.room_id) ?? null) : null;
  const photo = photoFor(room?.room_id ?? null);
  const floor = unit.floors[0];
  const hint = !picked ? "Pick a room below to fly there." : v.fixable && !hinges ? "A red door frame can often be fixed: try offset hinges." : null;
  return (
    <>
      <div className="pointer-events-none absolute top-28 left-6 flex flex-col items-start gap-3">
        <VerdictLine unit={unit} verdict={v} replay={pair.status === "ready" && pair.origin === "replay" ? (pair.reason ?? "") : null} />
        {!evidence && <ApartmentLegend hint={hint} />}
        {evidence && (
          <EvidencePanel
            kind={evidence}
            sid={sid}
            unit={unit}
            door={tourEdge ? (floor.doors.find((d) => d.edge === tourEdge) ?? null) : null}
            photo={photo}
            onClose={() => onEvidence(null)}
          />
        )}
      </div>
      {room && (
        <div className="pointer-events-none absolute top-28 right-6">
          <RoomCard
            room={room}
            hingesRoom={hingesRoom}
            drive={drive}
            chairIn={unit.chair_in}
            withHinges={hinges}
            photo={photo}
            hasTour={live && rulerEdge !== null}
            hasAerial={live}
            riding={ride}
            onHinges={onHinges}
            onRide={onRide}
            onEvidence={onEvidence}
          />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-6 bottom-6 flex items-end">
        <RoomStrip rooms={(hinges && hingesFloor ? hingesFloor : scannedFloor).rooms} selected={target} onSelect={onRoom} />
      </div>
    </>
  );
}
