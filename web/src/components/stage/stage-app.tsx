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
import { START_CHAIR, type ChairIn, type Step } from "@/lib/stage";
import { useAgentRun } from "@/lib/agent";
import { useUnitPair, useUnitsList } from "@/lib/data";
import { buildDrive, defaultTarget } from "@/lib/chair";
import { useDriveProgress } from "@/lib/drive-progress";
import { floorBounds } from "@/lib/plan-geometry";
import { isSynthetic, roomFrame, verdict, type VisionResult } from "@/lib/apartment";
import type { Floor, Room } from "@/lib/contract";
import { readSearch } from "@/lib/search";
import type { UnitRow } from "@/lib/contract";
import { readAgentReplay, webSenderId } from "@/components/workbench";
import { AgentPill, AgentTrace, AllUnits, ApprovalFocus, BestFits, CountsRow, FieldLegend, Narration } from "./search-overlay";
import { FieldScene, unitPosition } from "./field-scene";
import { ApartmentScene, modelCentre, modelToWorld } from "./apartment-scene";
import { ApartmentLegend, EvidencePanel, RoomCard, RoomStrip, VerdictLine, type EvidenceKind } from "./apartment-overlay";
import type { PoseGoal } from "./stage-canvas";
import { StepBar } from "./step-bar";
import { PublicBadge } from "@/components/public-badge";
import { PUBLIC_REPLAY } from "@/lib/public";
import { useOutboxEvents, type AnswerEvent } from "@/lib/outbox-events";
import { ChairPlate } from "./chair-plate";
import { ChairScene } from "./chair-scene";
import type { ChairKind } from "@/components/chair/wheelchair";
import { MoreScreen } from "./more-screen";

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

/** Beat 3's room: a bathroom still blocked with offset hinges (as scanned when there is no hinges result), one with a photo first. */
function stuckBathroom(scanned: Floor, hinges: Floor | null, hasPhoto: (roomId: string) => boolean): string | null {
  const after = (r: Room) => hinges?.rooms.find((h) => h.room_id === r.room_id)?.status ?? r.status;
  const baths = scanned.rooms.filter((r) => /bath/i.test(r.label) && after(r) !== "reachable");
  return (baths.find((r) => hasPhoto(r.room_id)) ?? baths[0])?.room_id ?? null;
}

/** The pitch, on number keys in presenter mode; each beat is a clean cut to a prepared state. */
type Beat = 1 | 2 | 3 | 4 | 5;
/** a tour opened from More: the door the ruler measures once the cut has settled */
const RULER_DOOR = "ruler";

/** the chair the units list was ranked for (its query), when it says */
function listChair(d: { query?: { w?: number | null; l?: number | null } | null }): [number, number] | null {
  const q = d.query;
  return q && typeof q.w === "number" && typeof q.l === "number" ? [q.w, q.l] : null;
}

/** `?sid=` units the list does not carry stand at the medical center */
const ORIGIN: [number, number, number] = [0, 0, 0];

function Stage() {
  const [entry] = useState(readEntry);
  const [step, setStep] = useState<Step>(entry.sid || entry.demo ? "apartment" : entry.search ? "search" : "chair");
  const [chair, setChair] = useState<ChairIn>(START_CHAIR);
  /** which chair is drawn on the footprint: a picture only, the engine tests width × length */
  const [chairKind, setChairKind] = useState<ChairKind>("manual");
  /** the chair the search was started with: the profile sent to /api/chat */
  const [profile, setProfile] = useState<ChairIn | null>(entry.search ? START_CHAIR : null);
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
    (c: ChairIn, opts?: { replay: boolean; pace: number }) => {
      startAgent(
        `Find units near the Medical Center my ${c[0]} × ${c[1]} in chair can live in. Check bedroom and bathroom access. ` +
          "If a bedroom or bathroom is still blocked with offset hinges, ask the leasing office whether that doorway can be widened.",
        { sender_id: webSenderId(), chair_in: [c[0], c[1]] },
        opts ?? { replay: readAgentReplay(), pace: entry.pace },
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
    if (entry.search) search(START_CHAIR);
    // once, on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const chosenPoint = useMemo(() => {
    const u = sid ? units.find((r) => r.sid === sid) : null;
    return u && origin ? unitPosition(u, origin) : null;
  }, [sid, units, origin]);
  const at = chosenPoint ?? ORIGIN;

  // after a run: deliveries by the iMessage bridge, and the leasing office's answers
  const outbox = useOutboxEvents(!PUBLIC_REPLAY);
  const [seenAnswer, setSeenAnswer] = useState<string | null>(null);
  const latestAnswer = outbox.answers.at(-1) ?? null;

  // ── step 3: the apartment ──
  // an answer about this unit refetches it: an answered room shows "asked"
  const pair = useUnitPair(sid, outbox.answers.filter((a) => a.sid === sid).length);
  const both = pair.status === "ready" ? pair.data : null;
  const [hinges, setHinges] = useState(false);
  const unit = both ? (hinges && both.hinges ? both.hinges : both.asScanned) : null;
  const floor = unit?.floors[0] ?? null;
  const scannedFloor = both?.asScanned.floors[0] ?? null;
  const hingesFloor = both?.hinges?.floors[0] ?? null;
  const [vision, setVision] = useState<VisionResult | null>(null);
  const hasPhoto = useCallback((roomId: string) => vision?.sid === sid && vision.items.some((i) => i.room_id === roomId), [vision, sid]);
  /** presenter mode's beat (null once the presenter clicks anything) */
  const [beat, setBeat] = useState<Beat | null>(entry.demo ? 1 : null);
  /** frames left to cut (no flight) after a beat key */
  const cut = useRef(0);
  /** the room the user picked (camera flies there); before that, the chair heads for the first room */
  const [pick, setPick] = useState<{ sid: string; room: string } | null>(null);
  const picked = pick && pick.sid === sid ? pick.room : null;
  const beatRoom = beat === 3 && scannedFloor ? stuckBathroom(scannedFloor, hingesFloor, hasPhoto) : null;
  const target = picked ?? beatRoom ?? (scannedFloor ? firstRoom(scannedFloor) : null);
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
  /** leaving the pitch for free play keeps what beat 3 shows (its room) */
  const leaveBeat = useCallback(() => {
    if (beat === 3 && sid && beatRoom) setPick({ sid, room: beatRoom });
    setBeat(null);
  }, [beat, sid, beatRoom]);
  /** the door the tour is about: the one clicked in the model, or the ruler's door when opened from the card */
  // (RULER_DOOR: whichever door the ruler measures once the view has settled)
  const [tourEdge, setTourEdge] = useState<string | null>(null);
  const showEvidence = useCallback(
    (kind: EvidenceKind | null) => {
      leaveBeat();
      if (kind === "tour") setTourEdge(rulerEdge);
      setEvidence(kind);
    },
    [rulerEdge, leaveBeat],
  );
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
  // beat 3 opens the bathroom's photo as soon as there is one
  const shownEvidence = evidence ?? (beat === 3 && photoFor(target) ? "photo" : null);

  const open = useCallback((next: string) => {
    setBeat(null);
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
      setBeat(null);
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
    leaveBeat();
    setStill(false);
    setRide((r) => !r);
    setGlide(true);
    setRunId((n) => n + 1);
  }, [leaveBeat]);

  const toggleHinges = useCallback(
    (on: boolean) => {
      leaveBeat();
      setStill(false);
      setHinges(on);
    },
    [leaveBeat],
  );

  // ── presenter mode ──
  /** the unit presenter mode opens on (from /api/demo) */
  const [demoSid, setDemoSid] = useState<string | null>(null);
  const approvalWaiting = view.approval !== null;
  const runStatus = agent.run.status;
  /**
   * The pitch: 1 the chair stopped at the bedroom door with the ruler; 2 offset hinges on, riding
   * along as the chair rolls in; 3 the bathroom still blocked, its photo open; 4 the search with a
   * run streaming (live when the API is up, else the labelled replay); 5 the approval card (a run
   * already waiting keeps its card; with no run, the recorded one plays at once, labelled replay).
   */
  const goBeat = useCallback(
    (b: Beat) => {
      // the apartment beats need a unit: the demo unit, or failing that the one open
      if (b <= 3 && !demoSid && !sid) return;
      cut.current = 3;
      setBeat(b);
      setEvidence(null);
      if (b <= 3) {
        if (demoSid) setSid(demoSid);
        setStep("apartment");
        setPick(null);
        setHinges(b > 1);
        setRide(b === 2);
        setStill(b !== 2);
        setGlide(true);
        setRunId((n) => n + 1);
        return;
      }
      setStep("search");
      setDismissed(null);
      if (b === 4) {
        setProfile(chair);
        search(chair);
      } else if (!approvalWaiting && runStatus !== "running") {
        setProfile(chair);
        search(chair, { replay: true, pace: 0 });
      }
    },
    [demoSid, sid, chair, search, approvalWaiting, runStatus],
  );
  // the demo unit is also where More's tiles open, so it is resolved outside ?demo=1 too (opened only in it)
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/demo", { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ sid?: unknown }>) : null))
      .then((d) => {
        if (ac.signal.aborted || typeof d?.sid !== "string") return;
        setDemoSid(d.sid);
        if (entry.demo) setSid(d.sid);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [entry.demo]);
  /** the agent's trace, opened from the pill: it takes the right rail while open */
  const [traceOpen, setTraceOpen] = useState(false);
  /** the "All apartments" list in the search step's right rail */
  const [allOpen, setAllOpen] = useState(false);
  const closeAll = useCallback(() => setAllOpen(false), []);
  /** "More" (M): everything the pitch leaves out, one keypress away */
  const [more, setMore] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setMore((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!entry.demo) return;
    const onKey = (e: KeyboardEvent) => {
      const b = e.key === "r" || e.key === "R" ? 1 : /^[1-5]$/.test(e.key) ? (Number(e.key) as Beat) : null;
      if (b === null) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setMore(false);
      goBeat(b);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry.demo, goBeat]);

  const scratch = useRef({ a: new THREE.Vector3(), b: new THREE.Vector3() });
  const pose = useCallback(
    (out: PoseGoal) => {
      // a beat key cuts: a few frames on the goal, so the drive's reset frame is cut to as well
      if (cut.current > 0) {
        cut.current -= 1;
        out.snap = true;
      }
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
          const [cx, cy, theta] = route.at(p);
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
          // a one-point route at the room's middle (no path from the engine): the chair's own heading
          if (Math.hypot(dx, dy) < 1e-3) [dx, dy] = [Math.cos(theta), Math.sin(theta)];
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

  const notice =
    latestAnswer && seenAnswer !== latestAnswer.id ? (
      <AnswerNotice
        answer={latestAnswer}
        onOpen={() => {
          setSeenAnswer(latestAnswer.id);
          const room = latestAnswer.rooms[0]?.room_id;
          open(latestAnswer.sid);
          if (room) setPick({ sid: latestAnswer.sid, room });
        }}
        onDismiss={() => setSeenAnswer(latestAnswer.id)}
      />
    ) : null;

  return (
    <div className="fixed inset-0 overflow-clip bg-paper">
      <PatternDefs />
      {/* isolate: the scene's labels stack inside the canvas layer, under every plate */}
      <div className="absolute inset-0 isolate">
        <StageCanvas pose={pose} onFallback={fallBack}>
          <ChairScene chair={step === "chair" ? chair : (profile ?? chair)} kind={chairKind} visible={step !== "apartment"} />
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
              chairKind={chairKind}
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
      {/* the overlay: four grid regions over the scene (globals.css .stage-grid); nothing is absolutely placed */}
      <div className="stage-grid">
        <header className="stage-top">
          <div className="flex flex-wrap items-center gap-3">
            <StepBar
              step={step}
              available={available}
              onStep={(next) => {
                leaveBeat();
                setTraceOpen(false);
                setStep(next);
              }}
            />
            <PublicBadge />
          </div>
          {step === "search" && <AgentPill run={agent.run} acting={agent.acting} steps={view.steps} open={traceOpen} onOpen={setTraceOpen} />}
        </header>
        {step === "chair" && (
          <>
            <div className="stage-left justify-end" data-wide>
              <ChairPlate chair={chair} onChair={setChair} kind={chairKind} onKind={setChairKind} onFind={find} />
            </div>
            {notice && <div className="stage-right justify-end">{notice}</div>}
          </>
        )}
        {step === "search" && (
          <>
            <div className="stage-left">
              {view.approval && dismissed !== view.approval.action_id && (
                // docked in the left rail: the field in the middle stays clear
                <ApprovalFocus
                  view={view}
                  decisions={agent.decisions}
                  onDecide={agent.decide}
                  onDismiss={() => setDismissed(view.approval?.action_id ?? null)}
                  delivered={outbox.delivered}
                />
              )}
              <div data-fixed className="mt-auto flex flex-col items-start gap-3">
                {/* the approval card has the rail first: the legend steps aside while it is open */}
                {!(view.approval && dismissed !== view.approval.action_id) && <FieldLegend acting={agent.acting} />}
                <Narration text={view.narration} acting={agent.acting} />
              </div>
            </div>
            {(traceOpen && agent.run.status !== "idle") || view.shortlist.length > 0 || notice || units.length > 0 ? (
              <div className="stage-right">
                {traceOpen && agent.run.status !== "idle" ? (
                  <AgentTrace run={agent.run} decisions={agent.decisions} onDecide={agent.decide} onEvidence={(e) => open(e.sid)} onClose={() => setTraceOpen(false)} />
                ) : allOpen ? (
                  <AllUnits units={units} chair={list.status === "ready" ? listChair(list.data) : null} onOpen={open} onClose={closeAll} />
                ) : (
                  <>
                    <BestFits view={view} onOpen={open} />
                    {units.length > 0 && (
                      <button
                        type="button"
                        data-fixed
                        onClick={() => setAllOpen(true)}
                        className="pointer-events-auto w-full border border-rule-strong bg-paper-lift px-4 py-3 text-left text-base font-semibold transition-colors transition-draft hover:border-ink"
                      >
                        All apartments <span className="measure font-normal text-ink-soft">({units.length})</span>
                      </button>
                    )}
                  </>
                )}
                {notice}
              </div>
            ) : null}
          </>
        )}
        {step === "apartment" && (
          <Apartment
            sid={sid}
            row={sid ? (units.find((u) => u.sid === sid) ?? null) : null}
            onBack={() => {
              setStep("search");
              setAllOpen(true);
            }}
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
            evidence={shownEvidence}
            photoFor={photoFor}
            rulerEdge={rulerEdge}
            tourEdge={tourEdge === RULER_DOOR ? rulerEdge : tourEdge}
            notice={notice}
            onRoom={selectRoom}
            onHinges={toggleHinges}
            onRide={toggleRide}
            onEvidence={showEvidence}
          />
        )}
      </div>
      {more && (
        <MoreScreen
          units={units}
          unitsReplay={list.status === "ready" && list.origin === "replay"}
          onClose={() => setMore(false)}
          actions={{
            // each opens the real feature on the demo unit (the pitch's prepared states), then leaves the pitch
            aerial: live
              ? () => {
                  setMore(false);
                  goBeat(1);
                  setBeat(null);
                  setEvidence("aerial");
                }
              : null,
            panorama: () => {
              setMore(false);
              goBeat(3);
            },
            memory: () => {
              setMore(false);
              goBeat(4);
            },
            labels: () => {
              setMore(false);
              goBeat(1);
            },
            // the ruler's door is resolved after the cut (beat 1's unit and room), not from the view More was opened over
            tour: live
              ? () => {
                  setMore(false);
                  goBeat(1);
                  setBeat(null);
                  setTourEdge(RULER_DOOR);
                  setEvidence("tour");
                }
              : null,
          }}
        />
      )}
    </div>
  );
}

/** The leasing office replied (after the run ended): what it answered, and the way to the room. */
function AnswerNotice({ answer, onOpen, onDismiss }: { answer: AnswerEvent; onOpen: () => void; onDismiss: () => void }) {
  const rooms = answer.rooms.map((r) => `${r.label}${r.clear_in.value != null ? `: ${r.clear_in.value.toFixed(1)} in clear` : ""}`);
  return (
    <section role="status" aria-live="polite" data-fixed className="pointer-events-auto mt-auto flex w-full flex-col gap-2 border-2 border-ink bg-paper-lift p-4">
      <h2 className="text-base font-semibold">The leasing office replied</h2>
      <p className="text-base">
        {rooms.length ? `${rooms.join("; ")} (asked, not measured).` : "Its reply answered no room the scan left unknown, so nothing changed."}
      </p>
      <div className="flex gap-2">
        {rooms.length > 0 && (
          <button type="button" onClick={onOpen} className="h-10 bg-ink px-4 text-base font-semibold text-paper hover:bg-ink-soft">
            Open the room
          </button>
        )}
        <button type="button" onClick={onDismiss} className="h-10 border border-ink px-4 text-base font-semibold hover:bg-paper-deep">
          Dismiss
        </button>
      </div>
    </section>
  );
}

function Apartment({
  sid,
  row,
  onBack,
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
  notice,
  onRoom,
  onHinges,
  onRide,
  onEvidence,
}: {
  sid: string | null;
  /** the unit’s row from /api/units, for its summary when the plan is not on this machine */
  row: UnitRow | null;
  onBack: () => void;
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
  /** the leasing office's reply, under the room card */
  notice: React.ReactNode;
  onRoom: (id: string) => void;
  onHinges: (on: boolean) => void;
  onRide: () => void;
  onEvidence: (k: EvidenceKind | null) => void;
}) {
  if (pair.status === "error") {
    // the plan is not on this machine (or could not be read): the batch's summary instead, never an error page
    return (
      <>
      <div className="stage-left">
        <section aria-labelledby="nofloor-title" className="pointer-events-auto flex w-full max-w-[32rem] flex-col gap-3 border border-rule-strong bg-paper-lift px-5 py-4">
          <h2 id="nofloor-title" className="display text-2xl font-bold">
            {row?.name ?? "This apartment"}
          </h2>
          {row ? (
            <>
              <p className="text-base">
                {row.summary} (estimated, from the overnight batch for a {row.chair_in[0]} × {row.chair_in[1]} in chair).
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CountsRow counts={row.counts} />
                {typeof row.distance_km === "number" && <span className="measure text-sm text-ink-soft">{row.distance_km.toFixed(1)} km est.</span>}
              </div>
            </>
          ) : null}
          <p role="status" className="text-base text-ink-soft">
            Its floor plan is not available on this machine, so the 3D model and the drive cannot be shown here.
          </p>
          <button type="button" onClick={onBack} className="self-start border border-rule-strong px-4 py-2 text-base font-semibold hover:border-ink">
            Back to all apartments
          </button>
        </section>
      </div>
      {notice && <div className="stage-right justify-end">{notice}</div>}
    </>
    );
  }
  if (!unit || !scannedFloor || !sid) {
    return (
      <>
      <div className="stage-left">
        <p role="status" className="pointer-events-auto self-start border border-rule-strong bg-paper-lift px-5 py-3 text-base">
          Building the apartment…
        </p>
      </div>
      {notice && <div className="stage-right justify-end">{notice}</div>}
    </>
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
      {/* evidence widens the left region into the middle column; the room card keeps the right rail */}
      <div className="stage-left" data-span={evidence ? "mid" : undefined}>
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
      {(room || notice) && (
        <div className="stage-right">
          {room && (
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
          )}
          {notice}
        </div>
      )}
      <div className="stage-bottom">
        <RoomStrip rooms={(hinges && hingesFloor ? hingesFloor : scannedFloor).rooms} selected={target} onSelect={onRoom} />
      </div>
    </>
  );
}
