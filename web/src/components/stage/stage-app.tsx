"use client";

/**
 * The guided stage at `/`: one full-screen 3D canvas behind everything, with the interface
 * floating over it (web/DESIGN.md, "The stage"). Three steps: Chair, Search, Apartment.
 * The three-panel layout stays at /classic, and is where the stage sends you if 3D cannot run.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { MotionConfig } from "motion/react";
import type * as THREE from "three";
import { PatternDefs } from "@/components/sheet/status";
import { readWebgl } from "@/components/plan/plan-stage";
import type { Step } from "@/lib/stage";
import { StepBar } from "./step-bar";

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
  return (
    <MotionConfig reducedMotion={forceReduce ? "always" : "user"}>
      <Stage />
    </MotionConfig>
  );
}

function Stage() {
  const [step, setStep] = useState<Step>("chair");
  const available: Record<Step, boolean> = { chair: true, search: false, apartment: false };

  const pose = useCallback(
    (out: { pos: THREE.Vector3; target: THREE.Vector3 }) => {
      if (step === "chair") {
        out.pos.set(2.2, 1.5, 2.6);
        out.target.set(-0.35, 0.45, 0);
      } else {
        out.pos.set(0, 110, 70);
        out.target.set(0, 0, 0);
      }
    },
    [step],
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper">
      <PatternDefs />
      <div className="absolute inset-0">
        <StageCanvas pose={pose} onFallback={fallBack} />
      </div>
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-6">
        <StepBar step={step} available={available} onStep={setStep} />
      </header>
    </div>
  );
}
