"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { AnimatedFigure } from "./animated-figure";
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

export interface PlanCtx {
  projection: Projection;
  floor: Floor;
  size: { w: number; h: number };
  /** strip to the right of the drawing kept free for callouts, when the plan leaves room */
  gutter: { x: number; w: number } | null;
}

/** width of the callout strip the plan steps aside for, when there is spare width */
const GUTTER = 288;

function layout(bounds: ReturnType<typeof floorBounds>, w: number, h: number) {
  const full = makeProjection(bounds, w, h, MARGIN);
  const planW = (bounds.maxX - bounds.minX) * full.scale + 2 * MARGIN;
  if (w - planW < GUTTER) return { projection: full, gutter: null };
  // same scale (height-limited), drawing shifted left to free the strip
  return { projection: makeProjection(bounds, w - GUTTER, h, MARGIN), gutter: { x: w - GUTTER, w: GUTTER } };
}

export interface FloorPlanProps {
  unit: UnitResult;
  floorIndex?: number;
  /** Layer drawn over walls, under dimensions and labels (the chair). */
  overlay?: (ctx: PlanCtx) => ReactNode;
  /** Layer drawn over everything (callouts). */
  annotations?: (ctx: PlanCtx) => ReactNode;
  /** Door edges to emphasise (e.g. the door that stopped the chair). */
  highlightDoor?: string | null;
  /** Rooms whose status differs from this baseline get a drawn outline (the hinge what-if). */
  baseline?: UnitResult | null;
  /** Rooms become buttons when given. */
  onRoomSelect?: (roomId: string) => void;
  selectedRoom?: string | null;
}

export function FloorPlan({ unit, floorIndex = 0, overlay, annotations, highlightDoor, onRoomSelect, selectedRoom, baseline }: FloorPlanProps) {
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

  const changed = useMemo(() => {
    const base = baseline?.floors[floorIndex];
    if (!base) return [] as Room[];
    return floor.rooms.filter((r) => base.rooms.find((b) => b.room_id === r.room_id)?.status !== r.status);
  }, [baseline, floor, floorIndex]);
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
          {...layout(bounds, size.w, size.h)}
          floor={floor}
          walls={walls}
          doors={doors}
          chairW={chairW}
          label={`Floor plan of ${unit.name}, ${floor.floor}. ${summary}.`}
          overlay={overlay}
          annotations={annotations}
          highlightDoor={highlightDoor ?? null}
          scenarioKey={unit.scenario}
          changed={changed}
          onRoomSelect={onRoomSelect}
          selectedRoom={selectedRoom ?? null}
        />
      )}
    </div>
  );
}

function PlanSvg({
  size,
  projection,
  gutter,
  floor,
  walls,
  doors,
  chairW,
  label,
  overlay,
  annotations,
  highlightDoor,
  scenarioKey,
  changed,
  onRoomSelect,
  selectedRoom,
}: {
  size: { w: number; h: number };
  projection: Projection;
  gutter: PlanCtx["gutter"];
  floor: Floor;
  walls: WallSegment[];
  doors: DoorGeometry[];
  chairW: number;
  label: string;
  overlay?: FloorPlanProps["overlay"];
  annotations?: FloorPlanProps["annotations"];
  highlightDoor: string | null;
  scenarioKey: string;
  changed: Room[];
  onRoomSelect?: (roomId: string) => void;
  selectedRoom: string | null;
}) {
  const reduce = useReducedMotionConfig();
  const { toScreen, scale } = projection;
  const poly = (pts: Point[]) => pts.map((p) => toScreen(p).join(",")).join(" ");
  const ctx: PlanCtx = { projection, floor, size, gutter };

  return (
    <svg width={size.w} height={size.h} role="group" aria-roledescription="floor plan" aria-label={label} className="absolute inset-0 block">
      {/* rooms, filled by status pattern; a scenario change cross-fades the fills */}
      <AnimatePresence initial={false}>
        <motion.g
          key={scenarioKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : DUR[3], ease: EASE_DRAFT }}
        >
          {floor.rooms.map((r) => (
            <polygon key={r.room_id} data-room={r.room_id} data-status={r.status} points={poly(r.polygon)} fill={STATUS[r.status].pattern} />
          ))}
        </motion.g>
      </AnimatePresence>

      {/* rooms whose status the what-if changed: a band drawn in once just inside the walls, then kept */}
      <g fill="none" strokeLinejoin="round">
        {changed.map((r) => (
          <g key={`${scenarioKey}:${r.room_id}`}>
            <clipPath id={`changed-${r.room_id}`}>
              <polygon points={poly(r.polygon)} />
            </clipPath>
            <motion.polygon
              points={poly(r.polygon)}
              clipPath={`url(#changed-${r.room_id})`}
              strokeWidth={22}
              stroke={`var(--${r.status === "reachable" ? "reach" : r.status === "blocked" ? "block" : "unknown"})`}
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : DUR[4], ease: EASE_DRAFT, delay: reduce ? 0 : DUR[2] }}
            />
          </g>
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

      {/* bathroom turning circles, where the engine says where the largest circle sits (contract v2) */}
      <g>
        {floor.rooms.map((r) => (r.turning_space?.center ? <TurningCircle key={r.room_id} room={r} projection={projection} /> : null))}
      </g>

      {/* chair and anything else drawn over the plan */}
      {overlay?.(ctx)}

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
            widthPx={roomExtentPx(r, scale)[0]}
            heightPx={roomExtentPx(r, scale)[1]}
            isStart={r.room_id === floor.start_room}
          />
        ))}
      </g>

      {/* rooms as buttons: transparent hit areas, outlined when selected or focused */}
      {onRoomSelect && (
        <g>
          {floor.rooms.map((r) => (
            <polygon
              key={r.room_id}
              points={poly(r.polygon)}
              role="button"
              tabIndex={0}
              aria-label={`Drive to ${r.label} (${STATUS[r.status].word.toLowerCase()})`}
              aria-pressed={selectedRoom === r.room_id}
              onClick={() => onRoomSelect(r.room_id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRoomSelect(r.room_id);
                }
              }}
              fill="transparent"
              className="plan-hit"
            />
          ))}
        </g>
      )}

      {annotations?.(ctx)}
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
  const ease = { transition: "stroke var(--dur-3) var(--ease-draft), fill var(--dur-3) var(--ease-draft)" };
  const title = `Door opening ${g.door.width_in.toFixed(1)} in; clear width about ${clear} in (estimated); ${
    blocked ? `not passable for a ${chairW.toFixed(1)} in chair` : "passable"
  }.`;

  return (
    <g data-door={g.door.edge} className="plan-door">
      <title>{title}</title>
      {/* jamb marks across the opening */}
      <line x1={j0[0]} y1={j0[1]} x2={j1[0]} y2={j1[1]} stroke={colour} style={ease} strokeWidth={emphasis ? 3 : 1.5} strokeDasharray={blocked ? "none" : "4 4"} />
      <g stroke={blocked ? "var(--block)" : "var(--ink-soft)"} style={ease} strokeWidth={emphasis ? 2.25 : 1.25}>
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
          style={ease}
        >
          <AnimatedFigure svg value={g.door.clear_in_est} />″ <tspan className="font-normal">est.</tspan>
        </text>
      </g>
    </g>
  );
}

/** On-screen width and height of a room's bounding box, used to decide how much label fits. */
function roomExtentPx(room: Room, scale: number): [number, number] {
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  return [(Math.max(...xs) - Math.min(...xs)) * scale, (Math.max(...ys) - Math.min(...ys)) * scale];
}

/** approximate advance of 16px text, for centring and fit checks */
const CHAR_PX = 9;

function RoomLabel({
  room,
  at,
  widthPx: w,
  heightPx: h,
  isStart,
}: {
  room: Room;
  at: Point;
  widthPx: number;
  heightPx: number;
  isStart: boolean;
}) {
  // a tall narrow room is lettered along its length, as on a drawing
  const nameW = room.label.length * CHAR_PX + 12;
  const rotate = nameW > w && h > w;
  const widthPx = rotate ? h : w;
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
    <g transform={`translate(${at[0]} ${at[1]})${rotate ? " rotate(-90)" : ""}`} className="plan-label">
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

/**
 * The 60 in circle a wheelchair needs to turn, drawn at the centre of the largest circle the
 * engine fitted between the room's walls. Solid when it fits, dashed red when it does not.
 * Walls only: fixtures are not in the scan. The legend and the callout say so; a label on the
 * plan would sit on the room's own label in a small bathroom.
 */
function TurningCircle({ room, projection }: { room: Room; projection: Projection }) {
  const ts = room.turning_space;
  if (!ts?.center) return null;
  const [cx, cy] = projection.toScreen(ts.center);
  const r = (60 * 0.0254 * projection.scale) / 2;
  const colour = ts.meets_60in ? "var(--reach)" : "var(--block)";
  return (
    <g aria-label={`${room.label}: 60 inch turning circle ${ts.meets_60in ? "fits" : "does not fit"}, walls only`} role="img">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={colour} strokeWidth={2} strokeDasharray={ts.meets_60in ? undefined : "8 6"} />
      <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} stroke={colour} strokeWidth={1.5} />
      <line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} stroke={colour} strokeWidth={1.5} />
    </g>
  );
}
