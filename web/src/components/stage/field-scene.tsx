"use client";

/**
 * Step 2 on the table: every unit from /api/units as a point placed by latitude and longitude
 * around the medical center (the origin), with 2, 5 and 10 km rings for scale. No map tiles.
 * A point's shape and colour say what the agent found, so status is never colour alone:
 * reachable = tall post, blocked = short post with a cross-bar, unknown = hollow ring on a stem,
 * not checked = a flat graphite dot. Points being checked now pulse in the accent.
 */
import { useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, Instance, Instances, Line } from "@react-three/drei";
import { useReducedMotionConfig } from "motion/react";
import type * as THREE from "three";
import type { UnitRow } from "@/lib/contract";
import type { PointStatus } from "@/lib/search";
import { FIELD_M_PER_KM, fieldPoint, kmFrom } from "@/lib/stage";
import { readPalette } from "@/lib/tokens";

const RINGS_KM = [2, 5, 10];
/** instance buffers are sized once (drei does not rebuild them when the limit changes) */
const CAPACITY = 2048;

export interface FieldProps {
  units: UnitRow[];
  origin: { lat: number; lon: number };
  status: Map<string, PointStatus>;
  /** shortlist sids in rank order: labelled with their rank */
  ranked: string[];
  /** the unit the apartment step opened: the only point left standing there */
  chosen: string | null;
  /** "full" in the search step, "chosen" in the apartment step, "hidden" in the chair step */
  mode: "full" | "chosen" | "hidden";
  onPick: (sid: string) => void;
}

export function unitPosition(u: UnitRow, origin: { lat: number; lon: number }): [number, number, number] | null {
  if (u.lat == null || u.lon == null) return null;
  return fieldPoint(kmFrom(origin, { lat: u.lat, lon: u.lon }));
}

export function FieldScene({ units, origin, status, ranked, chosen, mode, onPick }: FieldProps) {
  const [palette] = useState(readPalette);
  const placed = useMemo(
    () => units.flatMap((u) => {
      const p = unitPosition(u, origin);
      return p ? [{ u, p }] : [];
    }),
    [units, origin],
  );
  const groups = useMemo(() => {
    const g: Record<PointStatus, { sid: string; p: [number, number, number] }[]> = { unchecked: [], checking: [], reachable: [], blocked: [], unknown: [] };
    for (const { u, p } of placed) {
      if (mode === "chosen" && u.sid !== chosen) continue;
      g[status.get(u.sid) ?? "unchecked"].push({ sid: u.sid, p });
    }
    return g;
  }, [placed, status, mode, chosen]);
  const rings = useMemo(
    () =>
      RINGS_KM.map((km) =>
        Array.from({ length: 129 }, (_, i) => {
          const a = (i / 128) * Math.PI * 2;
          return [km * FIELD_M_PER_KM * Math.cos(a), 0.02, km * FIELD_M_PER_KM * Math.sin(a)] as [number, number, number];
        }),
      ),
    [],
  );
  const pick = (sid: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "";
    onPick(sid);
  };
  const hover = {
    onPointerOver: () => (document.body.style.cursor = "pointer"),
    onPointerOut: () => (document.body.style.cursor = ""),
  };
  const full = mode === "full";
  // not drawn at all when hidden: an invisible mesh still catches the pointer
  if (mode === "hidden") return null;

  return (
    <group>
      {full &&
        rings.map((pts, i) => (
          <group key={RINGS_KM[i]}>
            <Line points={pts} color={palette.ruleStrong} lineWidth={1} dashed dashSize={1.2} gapSize={0.9} />
            <Html position={[RINGS_KM[i] * FIELD_M_PER_KM * 0.71, 0.1, RINGS_KM[i] * FIELD_M_PER_KM * 0.71]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <span className="measure bg-paper px-1 text-sm whitespace-nowrap text-ink-soft">{RINGS_KM[i]} km</span>
            </Html>
          </group>
        ))}
      {full && (
        <group>
          {/* the medical center: a ring and a mast at the origin */}
          <mesh position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 3.2, 12]} />
            <meshStandardMaterial color={palette.ink} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[1.1, 1.4, 48]} />
            <meshBasicMaterial color={palette.ink} />
          </mesh>
          <Html position={[0, 3.6, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}>
            <span className="bg-paper px-1.5 text-sm font-semibold whitespace-nowrap text-ink">Medical center</span>
          </Html>
        </group>
      )}

      {/* not checked: flat dots */}
      {full && groups.unchecked.length > 0 && (
        <Instances limit={CAPACITY} range={groups.unchecked.length}>
          <cylinderGeometry args={[0.32, 0.32, 0.06, 10]} />
          <meshStandardMaterial color={palette.unknown} roughness={1} />
          {groups.unchecked.map(({ sid, p }) => (
            <Instance key={sid} position={[p[0], 0.03, p[2]]} />
          ))}
        </Instances>
      )}
      {groups.checking.length > 0 && <Checking points={groups.checking} colour={palette.agent} />}
      {groups.reachable.length > 0 && (
        <Instances limit={CAPACITY} range={groups.reachable.length}>
          <cylinderGeometry args={[0.5, 0.5, 4, 14]} />
          <meshStandardMaterial color={palette.reach} emissive={palette.reach} emissiveIntensity={palette.glow} />
          {groups.reachable.map(({ sid, p }) => (
            <Instance key={sid} position={[p[0], 2, p[2]]} onClick={pick(sid)} {...hover} />
          ))}
        </Instances>
      )}
      {groups.blocked.length > 0 && (
        <>
          <Instances limit={CAPACITY} range={groups.blocked.length}>
            <cylinderGeometry args={[0.5, 0.5, 1.4, 14]} />
            <meshStandardMaterial color={palette.block} emissive={palette.block} emissiveIntensity={palette.glow} />
            {groups.blocked.map(({ sid, p }) => (
              <Instance key={sid} position={[p[0], 0.7, p[2]]} onClick={pick(sid)} {...hover} />
            ))}
          </Instances>
          <Instances limit={CAPACITY} range={groups.blocked.length}>
            <boxGeometry args={[1.9, 0.3, 0.3]} />
            <meshStandardMaterial color={palette.block} />
            {groups.blocked.map(({ sid, p }) => (
              <Instance key={sid} position={[p[0], 1.45, p[2]]} />
            ))}
          </Instances>
        </>
      )}
      {groups.unknown.length > 0 && (
        <Instances limit={CAPACITY} range={groups.unknown.length}>
          <torusGeometry args={[0.7, 0.16, 8, 24]} />
          <meshStandardMaterial color={palette.unknown} />
          {groups.unknown.map(({ sid, p }) => (
            <Instance key={sid} position={[p[0], 1.6, p[2]]} onClick={pick(sid)} {...hover} />
          ))}
        </Instances>
      )}
      {full &&
        ranked.map((sid, i) => {
          const hit = placed.find((x) => x.u.sid === sid);
          if (!hit) return null;
          return (
            <Html key={sid} position={[hit.p[0], 5, hit.p[2]]} center zIndexRange={[7, 0]} style={{ pointerEvents: "none" }}>
              <span className="measure flex size-7 items-center justify-center border-2 border-ink bg-paper text-sm font-semibold text-ink">{i + 1}</span>
            </Html>
          );
        })}
    </group>
  );
}

/** Units the agent is checking now: an accent post whose glow breathes (steady with reduced motion). */
function Checking({ points, colour }: { points: { sid: string; p: [number, number, number] }[]; colour: string }) {
  const reduce = useReducedMotionConfig();
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.emissiveIntensity = reduce ? 0.5 : 0.3 + 0.3 * (1 + Math.sin(clock.elapsedTime * 3)) * 0.5;
  });
  return (
    <Instances limit={CAPACITY} range={points.length}>
      <cylinderGeometry args={[0.5, 0.5, 2.5, 14]} />
      <meshStandardMaterial ref={mat} color={colour} emissive={colour} emissiveIntensity={0.4} />
      {points.map(({ sid, p }) => (
        <Instance key={sid} position={[p[0], 1.25, p[2]]} />
      ))}
    </Instances>
  );
}
