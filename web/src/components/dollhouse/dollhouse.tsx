"use client";

/**
 * The apartment as a site model at night, built only from the contract (see web/DESIGN.md).
 * Model frame: metres, Z up. three.js: (x, z, -y), Y up. Lazy-loaded by the workbench.
 *
 * Walls are extruded from a to b at their thickness to WALL_H with gaps at doors; floors are
 * lit by status with the plan's patterns; the chair is sized from chair_in and driven along the
 * engine's path by the shared drive progress. The camera orbits slowly at rest and follows the
 * chair while it drives; with reduced motion it stays fixed. If WebGL fails, the context is
 * lost, or the frame rate stays low, `onFallback` hands the plan back to the 2D view.
 */
import { Component, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import { useReducedMotionConfig, type MotionValue } from "motion/react";
import * as THREE from "three";
import type { Floor, Point, Room, RoomStatus, UnitResult } from "@/lib/contract";
import type { Drive, RouteSampler } from "@/lib/chair";
import { M_PER_IN, centroid, doorGeometry, floorBounds, wallSegments } from "@/lib/plan-geometry";
import { readPalette, type Palette } from "@/lib/tokens";
import { STATUS } from "@/components/sheet/status";
import { CalloutBody } from "@/components/plan/chair-callout";

const WALL_H = 2.4;
const DOOR_H = 2.03;
const LEAF_T = 0.035;
/** below this, sustained over two windows, the model hands over to the 2D plan */
const MIN_FPS = 24;
/** leaf angle from the closed position: open as scanned, swung clear with offset hinges */
const LEAF_OPEN = Math.PI / 2;
const LEAF_CLEAR = (165 * Math.PI) / 180;

/** model (x, y, height) → three.js */
const v3 = (x: number, y: number, h = 0): [number, number, number] => [x, h, -y];

export interface DollhouseProps {
  unit: UnitResult;
  floor: Floor;
  drive: Drive | null;
  driving: boolean;
  progress: MotionValue<number>;
  s: RouteSampler;
  selectedRoom: string | null;
  onRoomSelect: (roomId: string) => void;
  /** a door the chair cannot pass was clicked (opens the tour); absent when there is no tour */
  onDoorOpen?: (edge: string) => void;
  onFallback: (reason: string) => void;
}

export function Dollhouse(props: DollhouseProps) {
  const [palette] = useState(readPalette);
  const b = useMemo(() => floorBounds(props.floor), [props.floor]);
  const centre: Point = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY, 4);
  const camPos: [number, number, number] = [span * 0.5, span * 1.0, span * 0.75];
  const hinges = props.unit.scenario !== "as scanned";
  const label = `3D model of ${props.unit.name}. ${props.floor.rooms.map((r) => `${r.label}: ${STATUS[r.status].word.toLowerCase()}`).join("; ")}.`;

  return (
    <div className="absolute inset-0" role="img" aria-label={label}>
      <Boundary onError={(m) => props.onFallback(`The 3D model failed: ${m}`)}>
        <Canvas dpr={[1, 1.5]} camera={{ fov: 38, position: camPos, near: 0.1, far: 300 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
          <color attach="background" args={[palette.paper]} />
          <hemisphereLight args={[palette.ink, palette.paper, 0.75]} />
          <directionalLight position={[-span, span * 1.6, span * 0.8]} intensity={1.1} color={palette.ink} />
          <Guards onFallback={props.onFallback} />
          <Rig {...props} centre={centre} span={span} />
          {/* everything in model coordinates, centred on the base board */}
          <group position={[-centre[0], 0, centre[1]]}>
            <BaseBoard floor={props.floor} palette={palette} />
            <Floors floor={props.floor} palette={palette} selected={props.selectedRoom} onSelect={props.onRoomSelect} />
            <Walls floor={props.floor} palette={palette} />
            <Doors floor={props.floor} palette={palette} hinges={hinges} drive={props.drive} driving={props.driving} onOpen={props.onDoorOpen} />
            <TurningCircles floor={props.floor} palette={palette} />
            <RoomLabels floor={props.floor} />
            {props.drive && <Chair chairIn={props.unit.chair_in} drive={props.drive} progress={props.progress} s={props.s} palette={palette} />}
            {props.drive && !props.driving && <Callout drive={props.drive} chairIn={props.unit.chair_in} hinges={hinges} />}
          </group>
        </Canvas>
      </Boundary>
    </div>
  );
}

class Boundary extends Component<{ onError: (message: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Hands over to the 2D plan when the context is lost or the frame rate stays under MIN_FPS. */
function Guards({ onFallback }: { onFallback: (reason: string) => void }) {
  const gl = useThree((st) => st.gl);
  const acc = useRef({ t: 0, frames: 0, warm: 0, low: 0, done: false });
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      onFallback("The 3D context was lost");
    };
    el.addEventListener("webglcontextlost", lost);
    return () => el.removeEventListener("webglcontextlost", lost);
  }, [gl, onFallback]);
  useFrame((_, dt) => {
    const a = acc.current;
    if (a.done) return;
    // a hidden tab throttles frames; that says nothing about the machine
    // and a frame this long is a pause (a throttled pane, a debugger), not a slow GPU
    if (document.visibilityState !== "visible" || dt > 0.5) {
      a.t = a.frames = 0;
      return;
    }
    if (a.warm < 1.5) {
      a.warm += dt;
      return;
    }
    a.t += dt;
    a.frames += 1;
    if (a.t < 2) return;
    const fps = a.frames / a.t;
    a.t = a.frames = 0;
    a.low = fps < MIN_FPS ? a.low + 1 : 0;
    if (a.low >= 2) {
      a.done = true;
      onFallback(`The 3D model ran at ${Math.round(fps)} fps`);
    }
  });
  return null;
}

/** Slow orbit at rest, follow the chair while it drives; fixed with reduced motion. */
function Rig({ drive, driving, progress, s, centre, span }: DollhouseProps & { centre: Point; span: number }) {
  const reduce = useReducedMotionConfig();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  /** seconds (performance clock) the user last let go of the camera; Infinity while they hold it */
  const touched = useRef(-Infinity);
  const scratch = useRef({
    offset: new THREE.Vector3(),
    goal: new THREE.Vector3(),
  });
  useFrame((st, dt) => {
    const c = controls.current;
    if (!c) return;
    const { offset, goal } = scratch.current;
    const following = driving && !reduce && drive != null;
    const idle = performance.now() / 1000 - touched.current > 4;
    c.autoRotate = !reduce && !following && idle;
    if (reduce) return;
    // while driving: look at the chair from close and steep, so walls don't hide it;
    // at rest: back out to frame the whole board and orbit its centre
    if (following) {
      const [x, y] = s.at(progress.get());
      goal.set(x - centre[0], 0.4, -(y - centre[1]));
    } else goal.set(0, 0, 0);
    const k = 1 - Math.exp(-dt * (following ? 3 : 1));
    c.target.lerp(goal, k);
    offset.copy(st.camera.position).sub(c.target);
    const want = following ? Math.max(6, span * 0.65) : span * 1.35;
    // ease the distance and keep a steep view (about 50° down) unless the viewer is steering
    if (idle || following) {
      offset.setLength(THREE.MathUtils.lerp(offset.length(), want, k));
      const minY = offset.length() * (following ? 0.8 : 0.72);
      if (offset.y < minY) offset.y = THREE.MathUtils.lerp(offset.y, minY, k);
      st.camera.position.copy(c.target).add(offset);
    }
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      enablePan={false}
      autoRotateSpeed={0.35}
      minDistance={3}
      maxDistance={span * 3}
      maxPolarAngle={1.2}
      onStart={() => (touched.current = Infinity)}
      onEnd={() => (touched.current = performance.now() / 1000)}
    />
  );
}

function BaseBoard({ floor, palette }: { floor: Floor; palette: Palette }) {
  const b = floorBounds(floor);
  const pad = 0.8;
  const w = b.maxX - b.minX + 2 * pad;
  const d = b.maxY - b.minY + 2 * pad;
  return (
    <mesh position={v3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, -0.06)} receiveShadow={false}>
      <boxGeometry args={[w, 0.1, d]} />
      <meshStandardMaterial color={palette.paperLift} roughness={1} />
    </mesh>
  );
}

/** The plan's status patterns, painted on a small tile: wash, 45° hatch, stipple. */
function patternTexture(status: RoomStatus, p: Palette): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = status === "reachable" ? p.reachWash : status === "blocked" ? p.blockWash : p.unknownWash;
  g.fillRect(0, 0, n, n);
  if (status === "blocked") {
    g.strokeStyle = p.block;
    g.lineWidth = 5;
    for (let k = -n; k <= n; k += n / 2) {
      g.beginPath();
      g.moveTo(k, n);
      g.lineTo(k + n, 0);
      g.stroke();
    }
  } else if (status === "unknown") {
    g.fillStyle = p.unknown;
    for (const [x, y] of [
      [n / 4, n / 4],
      [(3 * n) / 4, (3 * n) / 4],
    ]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3); // shape UVs are metres: one tile every 33 cm
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function Floors({ floor, palette, selected, onSelect }: { floor: Floor; palette: Palette; selected: string | null; onSelect: (id: string) => void }) {
  const textures = useMemo(
    () => ({
      reachable: patternTexture("reachable", palette),
      blocked: patternTexture("blocked", palette),
      unknown: patternTexture("unknown", palette),
    }),
    [palette],
  );
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures]);
  const glowOf = (s: RoomStatus) => (s === "reachable" ? palette.reach : s === "blocked" ? palette.block : palette.unknown);
  return (
    <group>
      {floor.rooms.map((r) => (
        <RoomFloor
          key={r.room_id}
          room={r}
          map={textures[r.status]}
          glow={glowOf(r.status)}
          intensity={r.status === "unknown" ? palette.glow / 3 : palette.glow}
          selected={selected === r.room_id}
          ink={palette.ink}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function RoomFloor({
  room,
  map,
  glow,
  intensity,
  selected,
  ink,
  onSelect,
}: {
  room: Room;
  map: THREE.Texture;
  glow: string;
  intensity: number;
  selected: boolean;
  ink: string;
  onSelect: (id: string) => void;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const outline = useMemo(() => [...room.polygon, room.polygon[0]].map(([x, y]) => v3(x, y, 0.025)), [room.polygon]);
  return (
    <group>
      {/* the shape lies in model x/y; turning it flat maps (x, y) to (x, 0, -y) */}
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(room.room_id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <meshStandardMaterial map={map} emissive={glow} emissiveIntensity={intensity} roughness={0.95} />
      </mesh>
      {selected && <Line points={outline} color={ink} lineWidth={2} />}
    </group>
  );
}

function Walls({ floor, palette }: { floor: Floor; palette: Palette }) {
  const segs = useMemo(() => wallSegments(floor), [floor]);
  return (
    <group>
      {segs.map((w, i) => {
        const dx = w.b[0] - w.a[0];
        const dy = w.b[1] - w.a[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.01) return null;
        return (
          <mesh key={i} position={v3((w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, WALL_H / 2)} rotation={[0, Math.atan2(dy, dx), 0]}>
            <boxGeometry args={[len, WALL_H, Math.max(w.thickness, 0.05)]} />
            <meshStandardMaterial color={palette.ink} roughness={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function Doors({
  floor,
  palette,
  hinges,
  drive,
  driving,
  onOpen,
}: {
  floor: Floor;
  palette: Palette;
  hinges: boolean;
  drive: Drive | null;
  driving: boolean;
  onOpen?: (edge: string) => void;
}) {
  const lit = drive?.kind === "blocked" && !driving ? drive.door?.edge : null;
  return (
    <group>
      {floor.doors.map((d) => (
        <DoorFrame key={d.edge + d.center.join()} floor={floor} door={d} palette={palette} hinges={hinges} lit={lit === d.edge} onOpen={onOpen} />
      ))}
    </group>
  );
}

function DoorFrame({
  floor,
  door,
  palette,
  hinges,
  lit,
  onOpen,
}: {
  floor: Floor;
  door: Floor["doors"][number];
  palette: Palette;
  hinges: boolean;
  lit: boolean;
  onOpen?: (edge: string) => void;
}) {
  const reduce = useReducedMotionConfig();
  const g = useMemo(() => doorGeometry(floor, door), [floor, door]);
  const wall = floor.walls.find((w) => w.edge === door.edge);
  const t = Math.max(wall?.thickness ?? 0.12, 0.05) + 0.02;
  const ux = g.j1[0] - g.j0[0];
  const uy = g.j1[1] - g.j0[1];
  const width = Math.hypot(ux, uy);
  const angle = Math.atan2(uy, ux);
  // the leaf swings to the side the plan draws the door's dimension on
  const side = ux * g.normal[1] - uy * g.normal[0] > 0 ? 1 : -1;
  const leaf = useRef<THREE.Group>(null);
  const target = hinges ? LEAF_CLEAR : LEAF_OPEN;
  useFrame((_, dt) => {
    const k = reduce ? 1 : 1 - Math.exp(-dt * 2.5);
    if (leaf.current) leaf.current.rotation.y = THREE.MathUtils.lerp(leaf.current.rotation.y, angle + side * target, k);
  });
  const frameColour = door.passable ? palette.ink : palette.block;
  const mid: Point = [(g.j0[0] + g.j1[0]) / 2, (g.j0[1] + g.j1[1]) / 2];
  // not passable is never colour alone: a dashed sill across the opening, as dashed means
  // "does not fit" for turning circles too
  const sill = useMemo(() => [v3(g.j0[0], g.j0[1], 0.03), v3(g.j1[0], g.j1[1], 0.03)], [g]);
  // a door the chair cannot pass opens the unit's tour, to see it as scanned
  const open = !door.passable && onOpen;
  const handlers = open
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onOpen(door.edge);
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => (document.body.style.cursor = ""),
      }
    : {};
  return (
    <group {...handlers}>
      {!door.passable && <Line points={sill} color={palette.block} lineWidth={4} dashed dashSize={0.06} gapSize={0.05} />}
      {/* jambs and head */}
      {[g.j0, g.j1].map((j, i) => (
        <mesh key={i} position={v3(j[0], j[1], DOOR_H / 2)} rotation={[0, angle, 0]}>
          <boxGeometry args={[0.05, DOOR_H, t]} />
          <LitMaterial colour={frameColour} glow={palette.block} lit={lit} />
        </mesh>
      ))}
      <mesh position={v3(mid[0], mid[1], (DOOR_H + WALL_H) / 2)} rotation={[0, angle, 0]}>
        <boxGeometry args={[width + 0.05, WALL_H - DOOR_H, t]} />
        <LitMaterial colour={frameColour} glow={palette.block} lit={lit} />
      </mesh>
      {/* the leaf, hinged at the first jamb */}
      <group ref={leaf} position={v3(g.j0[0], g.j0[1])} rotation={[0, angle + side * target, 0]}>
        <mesh position={[width / 2, (DOOR_H - 0.03) / 2, 0]}>
          <boxGeometry args={[width, DOOR_H - 0.03, LEAF_T]} />
          <meshStandardMaterial color={palette.inkSoft} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

/** The stopping door's frame lights up once the chair is there. */
function LitMaterial({ colour, glow, lit }: { colour: string; glow: string; lit: boolean }) {
  const reduce = useReducedMotionConfig();
  const m = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((_, dt) => {
    if (!m.current) return;
    const k = reduce ? 1 : 1 - Math.exp(-dt * 2.5);
    m.current.emissiveIntensity = THREE.MathUtils.lerp(m.current.emissiveIntensity, lit ? 1.1 : 0, k);
  });
  return <meshStandardMaterial ref={m} color={colour} emissive={glow} emissiveIntensity={0} roughness={0.7} />;
}

function TurningCircles({ floor, palette }: { floor: Floor; palette: Palette }) {
  return (
    <group>
      {floor.rooms.map((r) => {
        const ts = r.turning_space;
        if (!ts?.center) return null;
        const radius = (60 * M_PER_IN) / 2;
        const pts = Array.from({ length: 65 }, (_, i) => {
          const a = (i / 64) * Math.PI * 2;
          return v3(ts.center![0] + radius * Math.cos(a), ts.center![1] + radius * Math.sin(a), 0.03);
        });
        return (
          <Line
            key={r.room_id}
            points={pts}
            color={ts.meets_60in ? palette.reach : palette.block}
            lineWidth={2}
            dashed={!ts.meets_60in}
            dashSize={0.12}
            gapSize={0.08}
          />
        );
      })}
    </group>
  );
}

function RoomLabels({ floor }: { floor: Floor }) {
  return (
    <group>
      {floor.rooms.map((r) => {
        const [x, y] = centroid(r.polygon);
        const s = STATUS[r.status];
        const Icon = s.icon;
        return (
          <Html key={r.room_id} position={v3(x, y, 0.05)} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="flex items-center gap-1.5 bg-paper/80 px-1.5 text-sm font-semibold whitespace-nowrap text-ink">
              <Icon aria-hidden className={`size-4 shrink-0 ${s.text}`} strokeWidth={2.5} />
              {r.label}
            </div>
          </Html>
        );
      })}
    </group>
  );
}

/** The chair: seat, back and wheels on the width × length footprint the engine tested. */
function Chair({
  chairIn,
  drive,
  progress,
  s,
  palette,
}: {
  chairIn: [number, number];
  drive: Drive;
  progress: MotionValue<number>;
  s: RouteSampler;
  palette: Palette;
}) {
  const W = chairIn[0] * M_PER_IN;
  const L = chairIn[1] * M_PER_IN;
  const body = useRef<THREE.Group>(null);
  const mats = useRef<THREE.MeshStandardMaterial[]>([]);
  const colours = useMemo(
    () => ({
      moving: new THREE.Color(palette.agent),
      still: new THREE.Color(palette.ink),
    }),
    [palette],
  );
  const footprint = useMemo(
    () =>
      [
        [-L / 2, 0.02, -W / 2],
        [L / 2, 0.02, -W / 2],
        [L / 2, 0.02, W / 2],
        [-L / 2, 0.02, W / 2],
        [-L / 2, 0.02, -W / 2],
      ] as [number, number, number][],
    [W, L],
  );
  const track = useMemo(() => drive.route.map(([x, y]) => v3(x, y, 0.015)), [drive.route]);
  useFrame(() => {
    const g = body.current;
    if (!g) return;
    const p = progress.get();
    const [x, y, theta] = s.at(p);
    g.position.set(x, 0, -y);
    // theta turns the chair's length axis from +x (model, y up); in three that is a turn about Y
    g.rotation.y = theta;
    const c = p < 1 ? colours.moving : colours.still;
    for (const m of mats.current) m.color.copy(c);
  });
  const mat = (i: number) => (
    <meshStandardMaterial
      ref={(m) => {
        if (m) mats.current[i] = m;
      }}
      color={palette.ink}
      roughness={0.6}
    />
  );
  const wheelR = Math.min(0.3, W / 2);
  return (
    <>
      <Line points={track} color={palette.ruleStrong} lineWidth={1.5} dashed dashSize={0.15} gapSize={0.1} />
      <group ref={body}>
        <Line points={footprint} color={palette.ink} lineWidth={1.5} />
        {/* seat */}
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[L * 0.6, 0.07, W * 0.8]} />
          {mat(0)}
        </mesh>
        {/* back, at one end: the engine's chair has no front, so this is only a picture */}
        <mesh position={[-L * 0.3, 0.78, 0]}>
          <boxGeometry args={[0.06, 0.5, W * 0.8]} />
          {mat(1)}
        </mesh>
        {/* drive wheels and casters */}
        {[-1, 1].map((k) => (
          <mesh key={`w${k}`} position={[-L * 0.15, wheelR, (k * (W - 0.05)) / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[wheelR, wheelR, 0.04, 28]} />
            {mat(2 + (k + 1) / 2)}
          </mesh>
        ))}
        {[-1, 1].map((k) => (
          <mesh key={`c${k}`} position={[L * 0.4, 0.08, (k * (W - 0.12)) / 2]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.08, 0.08, 0.04, 16]} />
            {mat(4 + (k + 1) / 2)}
          </mesh>
        ))}
      </group>
    </>
  );
}

/** Where the drive ended: the plan's callout, pinned above the door (or the room). */
function Callout({ drive, chairIn, hinges }: { drive: Drive; chairIn: [number, number]; hinges: boolean }) {
  const at = drive.door?.center ?? drive.route.at(-1) ?? [0, 0];
  return (
    <Html position={v3(at[0], at[1], WALL_H + 0.2)} zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
      <div className="flex w-62 -translate-y-1/2 translate-x-4 flex-col gap-2 border-2 border-ink bg-paper-lift px-4 py-3" role="status" aria-live="polite">
        <CalloutBody drive={drive} chairIn={chairIn} hinges={hinges} />
      </div>
    </Html>
  );
}
