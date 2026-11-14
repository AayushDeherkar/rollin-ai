"use client";

import { useEffect, useMemo, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import type { PathStep } from "@/lib/contract";
import { M_PER_IN, type Projection } from "@/lib/plan-geometry";
import { sampler, type Drive } from "@/lib/chair";
import { DUR, EASE_DRAFT } from "@/lib/motion";

/** One glide: whole multiples of the longest duration step, so the scale stays one scale. */
function glideSeconds(lengthM: number) {
  return DUR[4] * Math.max(1, Math.ceil(lengthM / 2.5));
}

/**
 * The chair: a width × length rectangle (chair_in) that glides along the drive's route
 * with its heading, then settles. Cobalt while it moves (the agent is acting), ink once it stops.
 */
export function ChairLayer({
  drive,
  chairIn,
  projection,
  runId,
  onStart,
  onSettled,
}: {
  drive: Drive;
  chairIn: [number, number];
  projection: Projection;
  /** bump to replay the drive from the start */
  runId: number;
  /** called whenever a glide (re)starts, so the parent's "driving" state follows the animation */
  onStart: () => void;
  onSettled: () => void;
}) {
  const reduce = useReducedMotion();
  // key on the route's values: a scenario switch that leaves the route unchanged must not replay
  const routeKey = JSON.stringify(drive.route);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => sampler(drive.route), [routeKey]);
  // progress along the route, 0..1, driven by a motion value so frames don't go through effects
  const progress = useMotionValue(reduce ? 1 : 0);
  const [p, setP] = useState(progress.get());
  useMotionValueEvent(progress, "change", setP);
  const moving = p < 1;

  useEffect(() => {
    if (reduce || s.length === 0) {
      progress.jump(1);
      onSettled();
      return;
    }
    progress.jump(0);
    onStart();
    const controls = animate(progress, 1, {
      duration: glideSeconds(s.length),
      ease: EASE_DRAFT,
      onComplete: onSettled,
    });
    return () => controls.stop();
    // onStart/onSettled are stable from the parent; runId restarts the drive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, runId, reduce]);

  const { toScreen, scale } = projection;
  const pose = s.at(p);
  const [cx, cy] = toScreen([pose[0], pose[1]]);
  const deg = (-pose[2] * 180) / Math.PI; // y flipped on screen
  const lenPx = chairIn[1] * M_PER_IN * scale;
  const widPx = chairIn[0] * M_PER_IN * scale;
  const stroke = moving ? "var(--agent)" : "var(--ink)";

  // travelled track, split into engine path (solid) and drawn approach (dashed)
  const cut = drive.drawnFrom == null ? 1 : s.progressAt(drive.drawnFrom);
  const engineTrack = trackPoints(drive.route, s, 0, Math.min(p, cut), toScreen);
  const drawnTrack = p > cut ? trackPoints(drive.route, s, cut, p, toScreen) : "";

  return (
    <g className="chair-layer" aria-hidden>
      <polyline points={engineTrack} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      {drawnTrack && (
        <polyline points={drawnTrack} fill="none" stroke={stroke} strokeWidth={2.5} strokeDasharray="2 6" strokeLinecap="round" opacity={0.85} />
      )}
      <g transform={`translate(${cx} ${cy}) rotate(${deg})`}>
        <rect
          x={-lenPx / 2}
          y={-widPx / 2}
          width={lenPx}
          height={widPx}
          fill="var(--paper-lift)"
          fillOpacity={0.88}
          stroke={stroke}
          strokeWidth={2.5}
          style={{ transition: `stroke var(--dur-2) var(--ease-draft)` }}
        />
        {/* centre line on the length axis: the chair has no front in the engine's model */}
        <line x1={-lenPx / 2 + 4} y1={0} x2={lenPx / 2 - 4} y2={0} stroke={stroke} strokeWidth={1.25} strokeDasharray="6 4" />
      </g>
    </g>
  );
}

function trackPoints(route: PathStep[], s: ReturnType<typeof sampler>, from: number, to: number, toScreen: Projection["toScreen"]) {
  if (to <= from) return "";
  const pts: string[] = [];
  const push = (q: number) => {
    const pose = s.at(q);
    pts.push(toScreen([pose[0], pose[1]]).join(","));
  };
  push(from);
  for (let i = 1; i < route.length; i++) {
    const q = s.progressAt(i);
    if (q > from && q < to) push(q);
  }
  push(to);
  return pts.join(" ");
}
