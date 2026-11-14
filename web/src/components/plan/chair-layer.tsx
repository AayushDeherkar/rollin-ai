"use client";

import { useState } from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";
import type { PathStep } from "@/lib/contract";
import { M_PER_IN, type Projection } from "@/lib/plan-geometry";
import type { Drive, RouteSampler } from "@/lib/chair";

/**
 * The chair on the 2D plan: a width × length rectangle (chair_in) at the drive's current pose.
 * The drive itself runs in the workbench (useDriveProgress), shared with the 3D model.
 * Accent while it moves (the agent is acting), ink once it stops.
 */
export function ChairLayer({
  drive,
  chairIn,
  projection,
  progress,
  s,
}: {
  drive: Drive;
  chairIn: [number, number];
  projection: Projection;
  progress: MotionValue<number>;
  s: RouteSampler;
}) {
  const [p, setP] = useState(progress.get());
  useMotionValueEvent(progress, "change", setP);
  const moving = p < 1;

  const { toScreen, scale } = projection;
  const pose = s.at(p);
  const [cx, cy] = toScreen([pose[0], pose[1]]);
  const deg = (-pose[2] * 180) / Math.PI; // y flipped on screen
  const lenPx = chairIn[1] * M_PER_IN * scale;
  const widPx = chairIn[0] * M_PER_IN * scale;
  const stroke = moving ? "var(--agent)" : "var(--ink)";

  // the travelled part of the engine's route
  const track = trackPoints(drive.route, s, 0, p, toScreen);

  return (
    <g className="chair-layer" aria-hidden>
      <polyline points={track} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
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

function trackPoints(route: PathStep[], s: RouteSampler, from: number, to: number, toScreen: Projection["toScreen"]) {
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
