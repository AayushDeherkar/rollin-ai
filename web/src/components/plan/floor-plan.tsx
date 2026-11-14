"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban } from "lucide-react";
import type { Floor, Point, Room, UnitResult } from "@/lib/contract";
import {
  centroid,
  doorGeometry,
  floorBounds,
  geom,
  makeProjection,
  readableAngle,
  wallSegments,
  type DoorGeometry,
  type Projection,
  type WallSegment,
} from "@/lib/plan-geometry";
import { STATUS } from "@/components/sheet/status";

/** px between the wall face and a door's dimension line */
const DIM_OFFSET = 22;
/** px reserved around the plan for dimension lines that fall outside the walls */
const MARGIN = 52;

export interface FloorPlanProps {
  unit: UnitResult;
  floorIndex?: number;
  /** Extra layers drawn above the plan (the chair), given the projection in use. */
  overlay?: (ctx: { projection: Projection; floor: Floor }) => ReactNode;
  /** Door edges to emphasise (e.g. the door that stopped the chair). */
  highlightDoor?: string | null;
}

export function FloorPlan({ unit, floorIndex = 0, overlay, highlightDoor }: FloorPlanProps) {
  const floor = unit.floors[floorIndex];
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bounds = useMemo(() => floorBounds(floor), [floor]);
  const walls = useMemo(() => wallSegments(floor), [floor]);
  const doors = useMemo(() => floor.doors.map((d) => doorGeometry(floor, d)), [floor]);

  const [chairW] = unit.chair_in;
  const summary = floor.rooms.map((r) => `${r.label}: ${STATUS[r.status].word.toLowerCase()}`).join("; ");

  return (
    <div ref={box} className="relative h-full w-full">
      {size && size.w > 0 && size.h > 0 && (
        <PlanSvg
          size={size}
          projection={makeProjection(bounds, size.w, size.h, MARGIN)}
          floor={floor}
          walls={walls}
          doors={doors}
          chairW={chairW}
          label={`Floor plan of ${unit.name}, ${floor.floor}. ${summary}.`}
          overlay={overlay}
          highlightDoor={highlightDoor ?? null}
        />
      )}
    </div>
  );
}

function PlanSvg({
  size,
  projection,
  floor,
  walls,
  doors,
  chairW,
  label,
  overlay,
  highlightDoor,
}: {
  size: { w: number; h: number };
  projection: Projection;
  floor: Floor;
  walls: WallSegment[];
  doors: DoorGeometry[];
  chairW: number;
  label: string;
  overlay?: FloorPlanProps["overlay"];
  highlightDoor: string | null;
}) {
  const { toScreen, scale } = projection;
  const poly = (pts: Point[]) => pts.map((p) => toScreen(p).join(",")).join(" ");

  return (
    <svg width={size.w} height={size.h} role="img" aria-label={label} className="absolute inset-0 block">
      {/* rooms, filled by status pattern */}
      <g>
        {floor.rooms.map((r) => (
          <polygon key={r.room_id} data-room={r.room_id} points={poly(r.polygon)} fill={STATUS[r.status].pattern} className="plan-room" />
        ))}
      </g>

      {/* walls at measured thickness */}
      <g stroke="var(--ink)" strokeLinecap="butt">
        {walls.map((w, i) => {
          const a = toScreen(w.a);
          const b = toScreen(w.b);
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={Math.max(w.thickness * scale, 3)} />;
        })}
      </g>

      {/* chair and anything else drawn over the plan */}
      {overlay?.({ projection, floor })}

      {/* door dimension lines */}
      <g>
        {doors.map((g) => (
          <DoorDimension key={g.door.edge + g.door.center.join()} g={g} projection={projection} chairW={chairW} emphasis={highlightDoor === g.door.edge} />
        ))}
      </g>

      {/* room labels last so they sit above the hatch */}
      <g>
        {floor.rooms.map((r) => (
          <RoomLabel
            key={r.room_id}
            room={r}
            at={toScreen(centroid(r.polygon))}
            widthPx={roomWidthPx(r, scale)}
            isStart={r.room_id === floor.start_room}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Architectural dimension: extension lines from each jamb, a dimension line between them
 * with 45° ticks, and the clear width (estimated) in mono. Red with a ban mark when the
 * chair cannot pass.
 */
function DoorDimension({ g, projection, chairW, emphasis }: { g: DoorGeometry; projection: Projection; chairW: number; emphasis: boolean }) {
  const { toScreen } = projection;
  const j0 = toScreen(g.j0);
  const j1 = toScreen(g.j1);
  // screen-space normal (y flipped)
  const n: Point = [g.normal[0], -g.normal[1]];
  const off = (p: Point, k: number): Point => [p[0] + n[0] * k, p[1] + n[1] * k];
  const d0 = off(j0, DIM_OFFSET);
  const d1 = off(j1, DIM_OFFSET);
  const along = geom.unit(geom.sub(d1, d0));
  // 45° tick: along + normal
  const tick = geom.mul(geom.unit(geom.add(along, n)), 7);
  const mid: Point = [(d0[0] + d1[0]) / 2, (d0[1] + d1[1]) / 2];
  const labelAt = off(mid, 14);
  const angle = readableAngle(d0, d1);
  const blocked = !g.door.passable;
  const colour = blocked ? "var(--block)" : "var(--ink)";
  const clear = g.door.clear_in_est.toFixed(1);
  const title = `Door opening ${g.door.width_in.toFixed(1)} in; clear width about ${clear} in (estimated); ${
    blocked ? `not passable for a ${chairW.toFixed(1)} in chair` : "passable"
  }.`;

  return (
    <g data-door={g.door.edge} className="plan-door">
      <title>{title}</title>
      {/* jamb marks across the opening */}
      <line x1={j0[0]} y1={j0[1]} x2={j1[0]} y2={j1[1]} stroke={colour} strokeWidth={emphasis ? 3 : 1.5} strokeDasharray={blocked ? "none" : "4 4"} />
      <g stroke={blocked ? "var(--block)" : "var(--ink-soft)"} strokeWidth={emphasis ? 2.25 : 1.25}>
        <line x1={j0[0]} y1={j0[1]} x2={off(j0, DIM_OFFSET + 6)[0]} y2={off(j0, DIM_OFFSET + 6)[1]} />
        <line x1={j1[0]} y1={j1[1]} x2={off(j1, DIM_OFFSET + 6)[0]} y2={off(j1, DIM_OFFSET + 6)[1]} />
        <line x1={d0[0]} y1={d0[1]} x2={d1[0]} y2={d1[1]} />
        <line x1={d0[0] - tick[0]} y1={d0[1] - tick[1]} x2={d0[0] + tick[0]} y2={d0[1] + tick[1]} strokeWidth={2} />
        <line x1={d1[0] - tick[0]} y1={d1[1] - tick[1]} x2={d1[0] + tick[0]} y2={d1[1] + tick[1]} strokeWidth={2} />
      </g>
      <g transform={`translate(${labelAt[0]} ${labelAt[1]}) rotate(${angle})`}>
        {blocked && <Ban x={-58} y={-9} width={18} height={18} color="var(--block)" strokeWidth={2.5} aria-hidden />}
        <text
          x={blocked ? -36 : -34}
          y={0}
          dominantBaseline="central"
          className="measure plan-halo text-sm font-semibold"
          fill={colour}
        >
          {clear}″ <tspan className="font-normal">est.</tspan>
        </text>
      </g>
    </g>
  );
}

/** Horizontal extent of a room on screen, used to decide how much label fits. */
function roomWidthPx(room: Room, scale: number): number {
  const xs = room.polygon.map((p) => p[0]);
  return (Math.max(...xs) - Math.min(...xs)) * scale;
}

/** approximate advance of 16px text, for centring and fit checks */
const CHAR_PX = 9;

function RoomLabel({ room, at, widthPx, isStart }: { room: Room; at: Point; widthPx: number; isStart: boolean }) {
  const s = STATUS[room.status];
  const Icon = s.icon;
  const ts = room.turning_space;
  // narrow rooms keep the icon (pattern + icon still carry status); the word moves to the tooltip
  const showWord = widthPx >= 24 + s.word.length * CHAR_PX + 16;
  const rowW = 18 + (showWord ? 6 + s.word.length * CHAR_PX : 0);
  const x0 = -rowW / 2;
  const lines: { text: string; measure?: boolean }[] = [];
  if (isStart) lines.push({ text: "start" });
  if (ts && widthPx >= 200) {
    lines.push({ text: `turning ⌀ ${ts.max_circle_in.toFixed(1)} in`, measure: true });
    lines.push({ text: `${ts.meets_60in ? "meets" : "under"} 60 in, walls only` });
  }
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} className="plan-label">
      <title>{`${room.label}: ${s.word.toLowerCase()}${room.reason ? `. ${room.reason}` : ""}`}</title>
      <text textAnchor="middle" y={-14} className="plan-halo text-base font-semibold" fill="var(--ink)">
        {room.label}
      </text>
      <g transform="translate(0 10)">
        <Icon x={x0} y={-9} width={18} height={18} className={s.text} strokeWidth={2.5} aria-hidden />
        {showWord && (
          <text x={x0 + 24} dominantBaseline="central" className={`plan-halo text-sm font-semibold ${s.text}`} fill="currentColor">
            {s.word}
          </text>
        )}
      </g>
      {lines.map((l, i) => (
        <text key={l.text} textAnchor="middle" y={36 + i * 21} className={`plan-halo text-sm ${l.measure ? "measure" : ""}`} fill="var(--ink-soft)">
          {l.text}
        </text>
      ))}
    </g>
  );
}
