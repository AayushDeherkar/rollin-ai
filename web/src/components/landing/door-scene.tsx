"use client";

/**
 * The landing's one 3D scene, fixed behind the story: a wall with a doorway, and the chair rolling up
 * to it and stopping because the opening is narrower than the chair. The door is an example, labelled
 * as one; the chair is the sourced "manual wheelchair, average user" preset (27.0 × 39.8 in).
 *
 * The page writes how far the story has scrolled into `story.s` (0 hero, 1 the problem, 2 measure,
 * 3 test-drive, 4 ask); the camera eases between one pose per beat. Reduced motion: the chair is
 * already stopped, the camera stays on the hero pose. Lazy-loaded (no SSR).
 */
import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Edges, Grid, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { Boundary, ChairBody } from "@/components/dollhouse/dollhouse";
import { useChairMaterials } from "@/components/chair/wheelchair";
import { readPalette, type Palette } from "@/lib/tokens";
import presetsJson from "../../../../data/chair_presets.json";

export const M = 0.0254;
/** the sourced preset: manual wheelchair, average user (data/chair_presets.json), read from the file so it cannot drift */
const PRESET = presetsJson.presets.find((p) => p.name === "Manual wheelchair (average user)");
export const CHAIR: [number, number] = PRESET ? [PRESET.width_in, PRESET.length_in] : [27.0, 39.8];
/** the example doorway's clear width, in inches: an illustration, not a measurement */
export const DOOR_IN = 26;

export interface Story {
  s: number;
}

const W = CHAIR[0] * M;
const L = CHAIR[1] * M;
const OPEN = DOOR_IN * M;
const WALL_T = 0.12;
const WALL_H = 2.2;
/** where the chair's centre stops: its front 6 cm short of the wall */
const STOP_X = -L / 2 - 0.06;
const START_X = STOP_X - 3.2;
const ROLL_S = 2.6;

type Pose = { pos: [number, number, number]; look: [number, number, number] };
/** one camera pose per beat of the story */
const POSES: Pose[] = [
  { pos: [-4.6, 2.1, 3.3], look: [-0.5, 0.75, 0] }, // hero: behind and to the side, the gap in view
  { pos: [-2.6, 1.2, 0.45], look: [0.1, 0.75, 0] }, // the problem: low behind the chair, at the opening
  { pos: [STOP_X - 0.02, 3.6, 0.001], look: [STOP_X, 0, 0] }, // measure: straight down (a hair behind, on the same side as the poses around it, so the heading never flips)
  { pos: [STOP_X - 0.4, 1.4, 3.1], look: [STOP_X + 0.4, 0.55, 0] }, // test-drive: from the side
  { pos: [-5.4, 3.2, 4.2], look: [-0.3, 0.7, 0] }, // ask: wide
];

/** `live` false pauses drawing (the story is scrolled away) without losing the scene */
export function DoorScene({ story, reduce, live }: { story: React.RefObject<Story>; reduce: boolean; live: boolean }) {
  const [palette] = useState(readPalette);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Boundary onError={() => setFailed(true)}>
      <Canvas
        dpr={[1, 1.5]}
        frameloop={live ? "always" : "never"}
        camera={{ fov: 36, position: POSES[0].pos, near: 0.05, far: 200 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        aria-hidden
      >
        <color attach="background" args={[palette.floor]} />
        <hemisphereLight args={[palette.ink, palette.floor, 1.0]} />
        <directionalLight position={[-6, 10, 5]} intensity={1.1} color={palette.ink} />
        {/* the one rim light, from beyond the wall and low */}
        <directionalLight position={[6, 3, -6]} intensity={0.9} color={palette.ink} />
        <Grid
          position={[0, -0.002, 0]}
          infiniteGrid
          cellSize={0.5}
          sectionSize={2}
          cellThickness={0.6}
          sectionThickness={1}
          cellColor={palette.rule}
          sectionColor={palette.ruleStrong}
          fadeDistance={14}
          fadeStrength={1.5}
          followCamera={false}
        />
        <Camera story={story} reduce={reduce} />
        <Wall palette={palette} />
        <RollingChair palette={palette} story={story} reduce={reduce} />
      </Canvas>
    </Boundary>
  );
}

/** eases the camera between the beats; on wide screens the scene sits right of the text column */
function Camera({ story, reduce }: { story: React.RefObject<Story>; reduce: boolean }) {
  const pos = useMemo(() => new THREE.Vector3(...POSES[0].pos), []);
  const look = useMemo(() => new THREE.Vector3(...POSES[0].look), []);
  const goalPos = useMemo(() => new THREE.Vector3(), []);
  const goalLook = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const frame = useRef(0);
  const textRight = useRef(0);
  useFrame(({ camera, size }, dt) => {
    const s = reduce ? 0 : THREE.MathUtils.clamp(story.current?.s ?? 0, 0, POSES.length - 1);
    const i = Math.min(Math.floor(s), POSES.length - 2);
    const f = THREE.MathUtils.smootherstep(s - i, 0, 1);
    goalPos.set(...POSES[i].pos).lerp(tmp.set(...POSES[i + 1].pos), f);
    goalLook.set(...POSES[i].look).lerp(tmp.set(...POSES[i + 1].look), f);
    const k = reduce ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    pos.lerp(goalPos, k);
    look.lerp(goalLook, k);
    camera.position.copy(pos);
    camera.lookAt(look);
    const pc = camera as THREE.PerspectiveCamera;
    // the text column takes the left of a wide screen (lg and up, as the page lays it out): centre the
    // scene in the space right of it, measured from the page now and then, not every frame
    if (frame.current++ % 30 === 0) {
      const col = document.querySelector("[data-hero-text]")?.getBoundingClientRect();
      textRight.current = size.width >= 1024 && col ? col.right : 0;
    }
    const shift = textRight.current ? (textRight.current + size.width) / 2 - size.width / 2 : 0;
    if (shift > 0) pc.setViewOffset(size.width, size.height, -shift, 0, size.width, size.height);
    else pc.clearViewOffset();
  });
  return null;
}

/** a wall across the chair's path with the doorway in it, and the door swung open */
function Wall({ palette }: { palette: Palette }) {
  const side = 2.6;
  const halfOpen = OPEN / 2;
  const jamb = 0.05;
  return (
    <group>
      {([-1, 1] as const).map((k) => {
        const len = side - halfOpen;
        return (
          <mesh key={k} position={[WALL_T / 2, WALL_H / 2, k * (halfOpen + jamb + len / 2)]}>
            <boxGeometry args={[WALL_T, WALL_H, len]} />
            <meshStandardMaterial color={palette.ink} roughness={0.95} />
            <Edges color={palette.ruleStrong} />
          </mesh>
        );
      })}
      {/* jambs and head */}
      {([-1, 1] as const).map((k) => (
        <mesh key={`j${k}`} position={[WALL_T / 2, 2.03 / 2, k * (halfOpen + jamb / 2)]}>
          <boxGeometry args={[WALL_T + 0.02, 2.03, jamb]} />
          <meshStandardMaterial color={palette.ruleStrong} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[WALL_T / 2, (2.03 + WALL_H) / 2, 0]}>
        <boxGeometry args={[WALL_T, WALL_H - 2.03, OPEN + jamb * 2]} />
        <meshStandardMaterial color={palette.ink} roughness={0.95} />
        <Edges color={palette.ruleStrong} />
      </mesh>
      {/* the leaf, open 90° into the room beyond */}
      <mesh position={[WALL_T + OPEN / 2, 2.0 / 2, halfOpen + 0.02]}>
        <boxGeometry args={[OPEN + 0.04, 2.0, 0.035]} />
        <meshStandardMaterial color={palette.inkSoft} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** a dimension line with ticks, from a to b (both at the same height) */
function Dim({ a, b, colour }: { a: [number, number, number]; b: [number, number, number]; colour: string }) {
  const t = 0.05;
  return (
    <>
      <Line points={[a, b]} color={colour} lineWidth={1.5} />
      <Line points={[[a[0], a[1] - t, a[2]], [a[0], a[1] + t, a[2]]]} color={colour} lineWidth={1.5} />
      <Line points={[[b[0], b[1] - t, b[2]], [b[0], b[1] + t, b[2]]]} color={colour} lineWidth={1.5} />
    </>
  );
}

function RollingChair({ palette, story, reduce }: { palette: Palette; story: React.RefObject<Story>; reduce: boolean }) {
  const g = useRef<THREE.Group>(null);
  const labels = useRef<HTMLDivElement[]>([]);
  const materials = useChairMaterials(palette);
  const t0 = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const body = g.current;
    if (!body) return;
    if (t0.current === null) t0.current = clock.elapsedTime;
    const p = reduce ? 1 : Math.min(1, (clock.elapsedTime - t0.current - 0.4) / ROLL_S);
    const e = p <= 0 ? 0 : 1 - Math.pow(1 - p, 3);
    body.position.x = START_X + (STOP_X - START_X) * e;
    // the dimensions draw in once it has stopped; the measure beat shows the footprint's
    const s = story.current?.s ?? 0;
    const stopped = p >= 1 ? 1 : 0;
    const measure = reduce ? 0 : THREE.MathUtils.clamp(1 - Math.abs(s - 2) * 1.5, 0, 1);
    labels.current.forEach((el, i) => {
      if (!el) return;
      const o = i < 2 ? stopped * (1 - measure) : measure;
      el.style.opacity = String(o);
    });
  });
  const dimY = 1.02;
  const z0 = OPEN / 2;
  const shortIn = CHAIR[0] - DOOR_IN;
  return (
    <>
      <group ref={g} position={[reduce ? STOP_X : START_X, 0, 0]}>
        <ChairBody chairIn={CHAIR} kind="manual" palette={palette} materials={materials} />
        {/* the footprint's width and length, shown on the measure beat */}
        <Html position={[0, 0.03, W / 2 + 0.14]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => void (el && (labels.current[2] = el))} className="measure text-sm whitespace-nowrap text-ink opacity-0">
            {CHAIR[1].toFixed(1)} in long
          </div>
        </Html>
        <Html position={[-L / 2 - 0.16, 0.03, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => void (el && (labels.current[3] = el))} className="measure text-sm whitespace-nowrap text-ink opacity-0">
            {CHAIR[0].toFixed(1)} in wide
          </div>
        </Html>
      </group>
      {/* the door's clear opening, and the chair's width beneath it */}
      <group>
        <Dim a={[-0.02, dimY, -z0]} b={[-0.02, dimY, z0]} colour={palette.ink} />
        <Dim a={[STOP_X + L / 2, dimY - 0.2, -W / 2]} b={[STOP_X + L / 2, dimY - 0.2, W / 2]} colour={palette.block} />
        <Html position={[-0.02, dimY + 0.12, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => void (el && (labels.current[0] = el))} className="measure border border-rule-strong bg-paper-lift px-2 py-0.5 text-sm whitespace-nowrap text-ink opacity-0 transition-opacity duration-[var(--dur-4)]">
            {DOOR_IN} in clear (example door)
          </div>
        </Html>
        <Html position={[STOP_X + L / 2, dimY - 0.34, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => void (el && (labels.current[1] = el))} className="measure border border-block bg-paper-lift px-2 py-0.5 text-sm whitespace-nowrap text-ink opacity-0 transition-opacity duration-[var(--dur-4)]">
            chair {CHAIR[0].toFixed(1)} in: {shortIn.toFixed(1)} in too wide for the example
          </div>
        </Html>
      </group>
    </>
  );
}
