"use client";

/**
 * The one persistent canvas behind the whole stage. It never unmounts between steps: each step
 * names a camera goal and the director eases the camera toward it every frame, so a change of
 * step (even mid-flight) bends the path instead of cutting it. Reduced motion: the camera is set
 * on its goal at once. Lazy-loaded by the stage (no SSR).
 */
import { useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { useReducedMotionConfig } from "motion/react";
import * as THREE from "three";
import { Boundary, Guards } from "@/components/dollhouse/dollhouse";
import { readPalette } from "@/lib/tokens";

/** Where the camera should be and what it looks at, written into `out` each frame. */
export type Pose = (out: { pos: THREE.Vector3; target: THREE.Vector3 }, t: number) => void;

/** how quickly the camera closes on its goal (per second): unhurried, no overshoot */
const EASE_RATE = 1.6;

export function StageCanvas({ pose, onFallback, children }: { pose: Pose; onFallback: (reason: string) => void; children?: ReactNode }) {
  const [palette] = useState(readPalette);
  return (
    <Boundary onError={(m) => onFallback(`The 3D stage failed: ${m}`)}>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: 38, position: [2.2, 1.5, 2.6], near: 0.05, far: 2000 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={[palette.paper]} />
        <hemisphereLight args={[palette.ink, palette.paper, 0.75]} />
        <directionalLight position={[-6, 12, 6]} intensity={1.1} color={palette.ink} />
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
    goal: { pos: new THREE.Vector3(), target: new THREE.Vector3() },
    look: new THREE.Vector3(0, 0.45, 0),
    first: true,
  });
  useFrame(({ camera, clock }, dt) => {
    const s = st.current;
    pose(s.goal, clock.elapsedTime);
    // the first frame and reduced motion: be there, no flight
    const k = reduce || s.first ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * EASE_RATE);
    s.first = false;
    camera.position.lerp(s.goal.pos, k);
    s.look.lerp(s.goal.target, k);
    camera.lookAt(s.look);
  });
  return null;
}
