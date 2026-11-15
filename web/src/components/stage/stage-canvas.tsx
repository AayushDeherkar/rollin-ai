"use client";

/**
 * The one persistent canvas behind the whole stage. It never unmounts between steps: each step
 * names a camera goal and the director eases the camera toward it every frame, so a change of
 * step (even mid-flight) bends the path instead of cutting it. Reduced motion: the camera is set
 * on its goal at once. Lazy-loaded by the stage (no SSR).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { useReducedMotionConfig } from "motion/react";
import * as THREE from "three";
import { Boundary, Guards } from "@/components/dollhouse/dollhouse";
import { readPalette } from "@/lib/tokens";

/** Where the camera should be and what it looks at, written into `out` each frame. */
export type Pose = (out: PoseGoal, t: number) => void;
/** `rate` overrides how fast the camera closes on the goal this frame (riding along follows tightly) */
export interface PoseGoal {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  rate?: number;
  /** vertical field of view this frame, degrees (riding along sees wider, as a person does) */
  fov?: number;
  /** be on the goal this frame, no flight (presenter mode opening on, or resetting to, a set view) */
  snap?: boolean;
}

/** how quickly the camera closes on its goal (per second): unhurried, no overshoot */
const EASE_RATE = 1.6;
const FOV = 38;

export function StageCanvas({ pose, onFallback, children }: { pose: Pose; onFallback: (reason: string) => void; children?: ReactNode }) {
  const [palette] = useState(readPalette);
  useEffect(() => {
    // the canvas can measure its box before layout settles (a step opened straight from the
    // address, or presenter mode) and then never draw; a resize makes it measure again. One right
    // after mount is not always late enough on a slow first load, so two more follow.
    const nudge = () => window.dispatchEvent(new Event("resize"));
    const id = requestAnimationFrame(nudge);
    const timers = [400, 1500].map((ms) => window.setTimeout(nudge, ms));
    return () => {
      cancelAnimationFrame(id);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  return (
    <Boundary onError={(m) => onFallback(`The 3D stage failed: ${m}`)}>
      <Canvas
        dpr={[1, 1.5]}
        resize={{ scroll: false, debounce: 0 }}
        camera={{ fov: FOV, position: [2.2, 1.5, 2.6], near: 0.05, far: 2000 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[palette.paper]} />
        <hemisphereLight args={[palette.ink, palette.paper, 0.75]} />
        <directionalLight position={[-6, 12, 6]} intensity={1.1} color={palette.ink} />
        {/* one rim light from behind and low, so the chair's tubes and wheels read against the dark ground */}
        <directionalLight position={[5, 3.5, -8]} intensity={0.9} color={palette.ink} />
        <Guards onFallback={onFallback} />
        <Director pose={pose} />
        <Table rule={palette.rule} ruleStrong={palette.ruleStrong} />
        {children}
      </Canvas>
    </Boundary>
  );
}

/** The table: 1 m construction lines, heavier every 4 m (1 km in the field of units). They fade
 * at a distance that follows the camera, so the close chair view does not shimmer at the horizon. */
function Table({ rule, ruleStrong }: { rule: string; ruleStrong: string }) {
  const grid = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const m = grid.current?.material as THREE.ShaderMaterial | undefined;
    if (m?.uniforms?.fadeDistance) m.uniforms.fadeDistance.value = THREE.MathUtils.clamp(camera.position.length() * 2.2, 12, 300);
  });
  return (
    <Grid
      ref={grid}
      position={[0, -0.002, 0]}
      infiniteGrid
      cellSize={1}
      sectionSize={4}
      cellThickness={0.6}
      sectionThickness={1}
      cellColor={rule}
      sectionColor={ruleStrong}
      fadeDistance={20}
      fadeStrength={1.5}
      followCamera={false}
    />
  );
}

function Director({ pose }: { pose: Pose }) {
  const reduce = useReducedMotionConfig();
  const st = useRef({
    goal: { pos: new THREE.Vector3(), target: new THREE.Vector3() } as PoseGoal,
    look: new THREE.Vector3(0, 0.45, 0),
    first: true,
  });
  // the scene's centre is drawn in the middle of the open space between the overlay's rails
  // (a shifted projection, not a moved camera), so the chair and its door are never under a panel
  const zone = useRef({ x: 0, y: 0, tx: 0, ty: 0, n: 0 });
  useFrame(({ camera, clock, size }, dt) => {
    const z = zone.current;
    if (z.n++ % 12 === 0) [z.tx, z.ty] = openSpaceCentre(size.width, size.height);
    const kz = reduce || st.current.first ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    z.x += (z.tx - z.x) * kz;
    z.y += (z.ty - z.y) * kz;
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(z.x) > 0.5 || Math.abs(z.y) > 0.5) pc.setViewOffset(size.width, size.height, -z.x, -z.y, size.width, size.height);
    else if (pc.view?.enabled) pc.clearViewOffset();
    const s = st.current;
    s.goal.rate = undefined;
    s.goal.fov = undefined;
    s.goal.snap = undefined;
    pose(s.goal, clock.elapsedTime);
    // the first frame and reduced motion: be there, no flight
    const k = reduce || s.first || s.goal.snap ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * (s.goal.rate ?? EASE_RATE));
    s.first = false;
    camera.position.lerp(s.goal.pos, k);
    s.look.lerp(s.goal.target, k);
    camera.lookAt(s.look);
    const cam = camera as THREE.PerspectiveCamera;
    const fov = s.goal.fov ?? FOV;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * k;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/**
 * Offset (px, from the canvas centre) of the middle of the space the overlay leaves open: between
 * the left region (unless evidence spans into the middle) and the right rail, under the top bar
 * and over the bottom strip. When that space is too small to matter, the plain centre.
 */
function openSpaceCentre(w: number, h: number): [number, number] {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
  const L = rect(".stage-left:not([data-span])");
  const R = rect(".stage-right");
  const T = rect(".stage-top");
  const B = rect(".stage-bottom");
  let x0 = L ? L.right : 0;
  let x1 = R ? R.left : w;
  if (x1 - x0 < w * 0.3) [x0, x1] = [0, w];
  let y0 = T ? T.bottom : 0;
  let y1 = B ? B.top : h;
  if (y1 - y0 < h * 0.3) [y0, y1] = [0, h];
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2];
}
