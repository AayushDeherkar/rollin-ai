"use client";

/**
 * The wheelchair, modelled procedurally: a manual chair (tubular frame, spoked rear wheels with
 * push rims, casters on forks, seat and back with soft edges, armrests, footplates) and a power
 * chair (base, mid drive wheels, casters front and back, captain seat, joystick). It is drawn on the
 * width × length footprint the engine tests, so it resizes with `chairIn`: overall width is the
 * outside of the push rims (or tyres), overall length runs from the back of the rear wheels to the
 * footplates. Every proportion inside that box is a drawing, not a measurement.
 *
 * Resizing never rebuilds the frame or the wheels: tubes are one shared unit cylinder placed between
 * two points, and wheels are built at unit radius and scaled. Only the soft seat and back are
 * rebuilt, when their size changes.
 *
 * Axes: length along x (front is +x), width along z, y up, the footprint centred on the origin.
 */
import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Palette } from "@/lib/tokens";

export type ChairKind = "manual" | "power";

type V3 = [number, number, number];

/** shared geometry, built once */
const GEO = (() => {
  if (typeof window === "undefined") return null;
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
  // a wheel at unit radius, in the XY plane (axle along z)
  const tyre = new THREE.TorusGeometry(0.955, 0.045, 12, 48);
  const rim = new THREE.TorusGeometry(0.89, 0.022, 8, 48);
  const pushRim = new THREE.TorusGeometry(0.84, 0.026, 8, 48);
  const spokes = mergeGeometries(
    Array.from({ length: 18 }, (_, i) => {
      const a = (i / 18) * Math.PI * 2;
      // crossed lacing: each spoke leaves the hub a little off its own radius
      const off = (i % 2 ? 1 : -1) * 0.16;
      const hub = new THREE.Vector3(Math.cos(a + off) * 0.09, Math.sin(a + off) * 0.09, (i % 2 ? 1 : -1) * 0.035);
      const end = new THREE.Vector3(Math.cos(a) * 0.885, Math.sin(a) * 0.885, 0);
      const g = new THREE.CylinderGeometry(0.006, 0.006, hub.distanceTo(end), 4, 1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(hub).normalize()));
      g.translate((hub.x + end.x) / 2, (hub.y + end.y) / 2, (hub.z + end.z) / 2);
      return g;
    }),
  )!;
  const hub = new THREE.CylinderGeometry(0.1, 0.1, 0.12, 20).rotateX(Math.PI / 2);
  const disc = new THREE.CylinderGeometry(0.72, 0.72, 0.09, 36).rotateX(Math.PI / 2);
  const standoff = new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6).rotateX(Math.PI / 2);
  const knob = new THREE.SphereGeometry(1, 16, 12);
  return { unitCylinder, tyre, rim, pushRim, spokes, hub, disc, standoff, knob };
})();

/** the chair's materials: restrained, one metal, one fabric, dark tyres */
export function useChairMaterials(palette: Palette) {
  return useMemo(
    () => ({
      frame: new THREE.MeshStandardMaterial({ color: palette.inkSoft, metalness: 0.55, roughness: 0.38 }),
      bright: new THREE.MeshStandardMaterial({ color: palette.ink, metalness: 0.7, roughness: 0.28 }),
      tyre: new THREE.MeshStandardMaterial({ color: palette.rule, roughness: 0.92 }),
      fabric: new THREE.MeshStandardMaterial({ color: palette.ruleStrong, roughness: 0.95 }),
      base: new THREE.MeshStandardMaterial({ color: palette.rule, metalness: 0.25, roughness: 0.55 }),
    }),
    [palette],
  );
}
export type ChairMaterials = ReturnType<typeof useChairMaterials>;

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** a tube of radius r from a to b: the shared unit cylinder, placed */
function Tube({ a, b, r = 0.011, m }: { a: V3; b: V3; r?: number; m: THREE.Material }) {
  tmpA.set(...a);
  tmpB.set(...b);
  const len = tmpA.distanceTo(tmpB);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, tmpB.clone().sub(tmpA).normalize());
  return (
    <mesh
      geometry={GEO!.unitCylinder}
      material={m}
      position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]}
      quaternion={q}
      scale={[r, len, r]}
    />
  );
}

/** a spoked wheel with its push rim on the outer side (`side` is +1 or -1 along z) */
function SpokedWheel({ at, radius, side, m }: { at: V3; radius: number; side: 1 | -1; m: ChairMaterials }) {
  return (
    <group position={at} scale={radius}>
      <mesh geometry={GEO!.tyre} material={m.tyre} />
      <mesh geometry={GEO!.rim} material={m.frame} />
      <mesh geometry={GEO!.spokes} material={m.bright} />
      <mesh geometry={GEO!.hub} material={m.frame} />
      <group position={[0, 0, side * 0.09]}>
        <mesh geometry={GEO!.pushRim} material={m.bright} />
      </group>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return <mesh key={i} geometry={GEO!.standoff} material={m.frame} position={[Math.cos(a) * 0.86, Math.sin(a) * 0.86, side * 0.045]} />;
      })}
    </group>
  );
}

/** a solid drive wheel (power chair) */
function SolidWheel({ at, radius, m }: { at: V3; radius: number; m: ChairMaterials }) {
  return (
    <group position={at} scale={radius}>
      <mesh geometry={GEO!.tyre} material={m.tyre} scale={[1, 1, 2.2]} />
      <mesh geometry={GEO!.disc} material={m.frame} />
      <mesh geometry={GEO!.hub} material={m.bright} />
    </group>
  );
}

/** a caster: stem, fork and a small wheel trailing behind the stem (towards -x is the chair's back, so it trails to +x when rolling forward... drawn trailing back) */
function Caster({ x, z, top, r, m }: { x: number; z: number; top: number; r: number; m: ChairMaterials }) {
  const trail = -r * 0.6;
  return (
    <group>
      <Tube a={[x, top, z]} b={[x, r * 2 + 0.02, z]} r={0.012} m={m.frame} />
      <Tube a={[x, r * 2 + 0.02, z - 0.022]} b={[x + trail, r, z - 0.022]} r={0.007} m={m.frame} />
      <Tube a={[x, r * 2 + 0.02, z + 0.022]} b={[x + trail, r, z + 0.022]} r={0.007} m={m.frame} />
      <group position={[x + trail, r, z]} scale={r}>
        <mesh geometry={GEO!.tyre} material={m.tyre} scale={[1, 1, 3]} />
        <mesh geometry={GEO!.disc} material={m.frame} scale={[1, 1, 1.4]} />
      </group>
    </group>
  );
}

const SOFT = { radius: 0.022, smoothness: 3 } as const;

function ManualChair({ W, L, m }: { W: number; L: number; m: ChairMaterials }) {
  const R = THREE.MathUtils.clamp(L * 0.3, 0.2, 0.305);
  const axleX = -L / 2 + R;
  // the push rim's outside is the chair's width
  const wheelZ = W / 2 - R * 0.12;
  const fz = Math.max(0.12, wheelZ - 0.06); // frame, inside the wheels
  const sh = 0.49; // seat height
  const seatBackX = axleX - 0.04;
  const seatDepth = THREE.MathUtils.clamp(L * 0.42, 0.28, 0.46);
  const seatFrontX = seatBackX + seatDepth;
  const footX = Math.min(L / 2 - 0.08, seatFrontX + 0.24); // the plate (0.15 long) stays inside the footprint
  const footY = 0.1;
  const casterR = 0.065;
  const casterX = Math.min(seatFrontX - 0.02, L / 2 - casterR * 2);
  const rail = sh - 0.035;
  const q = (v: number) => Math.round(v * 200) / 200; // soft parts rebuild only at 5 mm steps
  return (
    <group>
      {([-1, 1] as const).map((k) => {
        const z = k * fz;
        return (
          <group key={k}>
            <SpokedWheel at={[axleX, R, k * wheelZ]} radius={R} side={k} m={m} />
            {/* side frame: seat rail, the bend down to the footrest, lower rail, back cane and push handle */}
            <Tube a={[seatBackX, rail, z]} b={[seatFrontX, rail, z]} m={m.frame} />
            <Tube a={[seatFrontX, rail, z]} b={[footX - 0.05, footY + 0.06, z * 0.8]} m={m.frame} />
            <Tube a={[seatBackX + 0.02, 0.27, z]} b={[casterX, 0.27, z]} m={m.frame} />
            <Tube a={[seatBackX, rail, z]} b={[seatBackX, 0.27, z]} m={m.frame} />
            <Tube a={[seatBackX, rail, z]} b={[seatBackX - 0.05, 0.93, z]} m={m.frame} />
            <Tube a={[seatBackX - 0.05, 0.93, z]} b={[seatBackX - 0.15, 0.93, z]} r={0.014} m={m.tyre} />
            {/* axle bracket */}
            <Tube a={[axleX, 0.27, z]} b={[axleX, R, k * (wheelZ - 0.03)]} r={0.012} m={m.frame} />
            <Caster x={casterX} z={z} top={rail} r={casterR} m={m} />
            {/* armrest on two posts */}
            <Tube a={[seatBackX + 0.05, rail, z]} b={[seatBackX + 0.05, 0.7, z]} m={m.frame} />
            <Tube a={[seatBackX + 0.27, rail, z]} b={[seatBackX + 0.27, 0.7, z]} m={m.frame} />
            <RoundedBox args={[0.32, 0.034, 0.06]} {...SOFT} radius={0.015} position={[seatBackX + 0.16, 0.715, z]} material={m.fabric} />
            {/* footplate */}
            <RoundedBox args={[0.15, 0.014, q(Math.max(0.08, fz * 0.8 - 0.02))]} {...SOFT} radius={0.006} position={[footX, footY, k * fz * 0.42]} material={m.base} />
          </group>
        );
      })}
      {/* cross brace under the seat */}
      <Tube a={[seatBackX + 0.12, 0.3, -fz]} b={[seatBackX + 0.12, 0.3, fz]} r={0.009} m={m.frame} />
      {/* seat and back: soft-edged cushions */}
      <RoundedBox args={[q(seatDepth), 0.065, q(fz * 2 - 0.01)]} {...SOFT} position={[(seatBackX + seatFrontX) / 2, sh, 0]} material={m.fabric} />
      <RoundedBox args={[0.055, 0.4, q(fz * 2 - 0.01)]} {...SOFT} position={[seatBackX - 0.035, sh + 0.24, 0]} rotation={[0, 0, 0.09]} material={m.fabric} />
    </group>
  );
}

function PowerChair({ W, L, m }: { W: number; L: number; m: ChairMaterials }) {
  const driveR = 0.17;
  const wheelZ = W / 2 - 0.05;
  const baseL = L * 0.72;
  const casterR = 0.06;
  const seatDepth = THREE.MathUtils.clamp(L * 0.4, 0.34, 0.5);
  const seatW = Math.max(0.3, W * 0.72);
  const seatX = -0.04;
  const seatBackX = seatX - seatDepth / 2;
  const sh = 0.52;
  const armZ = seatW / 2 + 0.03;
  const footX = L / 2 - 0.09; // the plate (0.17 long) stays inside the footprint
  const q = (v: number) => Math.round(v * 200) / 200;
  return (
    <group>
      {/* the base: batteries and motors */}
      <RoundedBox args={[q(baseL), 0.2, q(W * 0.74)]} radius={0.04} smoothness={3} position={[-L * 0.02, 0.23, 0]} material={m.base} />
      {([-1, 1] as const).map((k) => (
        <group key={k}>
          <SolidWheel at={[0, driveR, k * wheelZ]} radius={driveR} m={m} />
          <Caster x={L / 2 - 0.1} z={k * (W / 2 - 0.12)} top={0.24} r={casterR} m={m} />
          <Caster x={-L / 2 + 0.1 + casterR} z={k * (W / 2 - 0.12)} top={0.24} r={casterR} m={m} />
          {/* armrest */}
          <Tube a={[seatBackX + 0.08, sh, k * armZ]} b={[seatBackX + 0.08, 0.69, k * armZ]} r={0.013} m={m.frame} />
          <RoundedBox args={[0.3, 0.04, 0.07]} radius={0.016} smoothness={3} position={[seatBackX + 0.18, 0.705, k * armZ]} material={m.fabric} />
        </group>
      ))}
      {/* seat post, captain seat, back and headrest */}
      <Tube a={[seatX, 0.33, 0]} b={[seatX, sh - 0.05, 0]} r={0.035} m={m.frame} />
      <RoundedBox args={[q(seatDepth), 0.1, q(seatW)]} radius={0.035} smoothness={3} position={[seatX, sh, 0]} material={m.fabric} />
      <RoundedBox args={[0.09, 0.52, q(seatW * 0.94)]} radius={0.035} smoothness={3} position={[seatBackX - 0.03, sh + 0.32, 0]} rotation={[0, 0, 0.1]} material={m.fabric} />
      <RoundedBox args={[0.08, 0.13, q(seatW * 0.45)]} radius={0.03} smoothness={3} position={[seatBackX - 0.07, sh + 0.66, 0]} rotation={[0, 0, 0.1]} material={m.fabric} />
      {/* joystick on the right armrest */}
      <group position={[seatBackX + 0.32, 0.725, armZ]}>
        <RoundedBox args={[0.1, 0.05, 0.075]} radius={0.012} smoothness={3} material={m.base} />
        <Tube a={[0, 0.02, 0]} b={[0.006, 0.08, 0]} r={0.006} m={m.bright} />
        <mesh geometry={GEO!.knob} material={m.bright} position={[0.007, 0.088, 0]} scale={0.018} />
      </group>
      {/* footplate on a centre hanger */}
      <Tube a={[baseL / 2 - L * 0.04, 0.27, 0]} b={[footX - 0.05, 0.1, 0]} r={0.016} m={m.frame} />
      <RoundedBox args={[0.17, 0.016, q(W * 0.5)]} radius={0.006} smoothness={3} position={[footX, 0.09, 0]} material={m.base} />
    </group>
  );
}

/** The chair at full size, length along x, footprint centred on the origin. */
export function Wheelchair({ chairIn, kind, materials }: { chairIn: [number, number]; kind: ChairKind; materials: ChairMaterials }) {
  if (!GEO) return null;
  const W = chairIn[0] * 0.0254;
  const L = chairIn[1] * 0.0254;
  return kind === "power" ? <PowerChair W={W} L={L} m={materials} /> : <ManualChair W={W} L={L} m={materials} />;
}
