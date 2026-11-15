"use client";

/**
 * Step 3 on the table: the dollhouse (the classic view's model) standing on the chosen unit's
 * point in the field. Its walls rise as the camera arrives. At the door that stops the chair a
 * ruler snaps across the opening with the clear width, the chair width and the shortfall, each
 * estimate marked est.; with offset hinges it turns green if the chair now fits.
 */
import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { useReducedMotionConfig } from "motion/react";
import type * as THREE from "three";
import { Model, type ModelProps } from "@/components/dollhouse/dollhouse";
import type { Floor, Point } from "@/lib/contract";
import { doorGeometry, floorBounds } from "@/lib/plan-geometry";
import { readPalette } from "@/lib/tokens";

/** model (x, y, height) → world, for a model centred on `at` */
export function modelToWorld(at: [number, number, number], centre: Point, [x, y]: Point, h = 0): [number, number, number] {
  return [at[0] + x - centre[0], at[1] + h, at[2] - (y - centre[1])];
}

export function modelCentre(floor: Floor): Point {
  const b = floorBounds(floor);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

export function ApartmentScene({
  at,
  shown,
  ruler,
  ...model
}: ModelProps & {
  at: [number, number, number];
  /** false while the camera is elsewhere: the walls lie flat */
  shown: boolean;
  /** the door to measure (edge), shown once the chair has stopped */
  ruler: string | null;
}) {
  const reduce = useReducedMotionConfig();
  const raise = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = raise.current;
    if (!g) return;
    const goal = shown ? 1 : 0.001;
    const k = reduce ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 2.2);
    g.scale.y += (goal - g.scale.y) * k;
    g.visible = g.scale.y > 0.01;
  });
  const centre = useMemo(() => modelCentre(model.floor), [model.floor]);
  return (
    <group position={at}>
      <group ref={raise} scale={[1, 0.001, 1]}>
        <Model {...model} callout={false} labels={shown} />
      </group>
      {shown && ruler && <DoorRuler floor={model.floor} edge={ruler} chairIn={model.unit.chair_in} centre={centre} />}
    </group>
  );
}

/** The ruler across the opening of the door that stops the chair. */
function DoorRuler({ floor, edge, chairIn, centre }: { floor: Floor; edge: string; chairIn: [number, number]; centre: Point }) {
  const [palette] = useState(readPalette);
  const reduce = useReducedMotionConfig();
  const door = floor.doors.find((d) => d.edge === edge) ?? null;
  const g = useMemo(() => (door ? doorGeometry(floor, door) : null), [floor, door]);
  const bar = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    // snaps open across the opening from its middle
    if (bar.current) bar.current.scale.x += (1 - bar.current.scale.x) * (reduce ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 8));
  });
  if (!door || !g) return null;
  const local = (p: Point, h: number) => modelToWorld([0, 0, 0], centre, p, h);
  const mid: Point = [(g.j0[0] + g.j1[0]) / 2, (g.j0[1] + g.j1[1]) / 2];
  const H = 1.0;
  const a = local(g.j0, H);
  const b = local(g.j1, H);
  const m = local(mid, H);
  const rel = (p: [number, number, number]): [number, number, number] => [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
  const fits = door.clear_in_est >= chairIn[0];
  const colour = fits ? palette.reach : palette.block;
  const diff = Math.round(Math.abs(door.clear_in_est - chairIn[0]) * 10) / 10;
  const tick = (p: [number, number, number]) => [rel([p[0], p[1] - 0.15, p[2]]), rel([p[0], p[1] + 0.15, p[2]])] as [number, number, number][];
  return (
    <group position={m}>
      <group ref={bar} scale={[reduce ? 1 : 0.01, 1, 1]}>
        <Line points={[rel(a), rel(b)]} color={colour} lineWidth={4} />
        <Line points={tick(a)} color={colour} lineWidth={4} />
        <Line points={tick(b)} color={colour} lineWidth={4} />
      </group>
      <Html position={[0, 0.9, 0]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
        <div role="status" aria-live="polite" className="flex w-64 flex-col gap-0.5 border-2 border-ink bg-paper-lift px-3 py-2 text-sm">
          <Row label="Clear width" value={`${door.clear_in_est.toFixed(1)} in`} est />
          <Row label="Chair width" value={`${chairIn[0].toFixed(1)} in`} />
          <Row label={fits ? "Spare" : "Short by"} value={`${diff.toFixed(1)} in`} est tone={fits ? "text-reach" : "text-block"} />
        </div>
      </Html>
    </group>
  );
}

function Row({ label, value, est, tone }: { label: string; value: string; est?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="whitespace-nowrap text-ink-soft">{label}</span>
      <span className={`measure font-semibold whitespace-nowrap ${tone ?? "text-ink"}`}>
        {value}
        {est && <span className="font-normal text-ink-soft"> est.</span>}
      </span>
    </div>
  );
}
