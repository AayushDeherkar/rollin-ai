/**
 * The chair's drive through a plan, built from the contract.
 *
 * Heading convention (engine/fit.py rect_kernel): theta rotates the chair's LENGTH axis
 * from +x in the model frame (y up). Headings live in [0, π): a rectangle has no front.
 *
 * Honesty: a reachable room is driven along the engine's own `path`. A blocked room has no
 * engine path, so the route is the start room's engine path plus a short straight approach
 * to the blocking door that we draw for illustration. That segment is marked
 * `drawnFrom` so the UI can draw it differently and say so.
 */
import type { Door, Floor, PathStep, Point, Room, UnitResult } from "./contract";
import { M_PER_IN, centroid, geom } from "./plan-geometry";

export type DriveKind = "arrive" | "blocked" | "tight" | "no-door";

export interface Drive {
  room: Room;
  kind: DriveKind;
  /** chair centre + heading, metres / radians, model frame */
  route: PathStep[];
  /** index in `route` from which the segment is a drawn approach, not an engine path */
  drawnFrom: number | null;
  /** the door that stops the chair (kind "blocked") */
  door: Door | null;
  /** chair width minus estimated clear width, inches (kind "blocked") */
  shortfallIn: number | null;
  /** for "arrive": the room's widest door and its spare clear width over the chair, inches */
  spareIn?: number | null;
  /** true when the route is the engine's own `path` for this room (not a fallback point) */
  enginePath?: boolean;
}

const SAME = 1e-6;
const samePoint = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME;

/** The room the drive should open on: first blocked room with a measured door, else any blocked, else first non-start room. */
export function defaultTarget(floor: Floor): string | null {
  const blocked = floor.rooms.filter((r) => r.status === "blocked");
  const withDoor = blocked.find((r) => r.doors.length > 0);
  return (withDoor ?? blocked[0] ?? floor.rooms.find((r) => r.room_id !== floor.start_room) ?? null)?.room_id ?? null;
}

export function buildDrive(unit: UnitResult, floor: Floor, roomId: string): Drive | null {
  const room = floor.rooms.find((r) => r.room_id === roomId);
  if (!room) return null;
  const start = floor.rooms.find((r) => r.room_id === floor.start_room);
  const base: PathStep[] = start?.path?.length
    ? start.path
    : start
      ? [[...centroid(start.polygon), 0] as PathStep]
      : [];

  if (room.status === "reachable") {
    const route = room.path?.length ? room.path : [[...centroid(room.polygon), 0] as PathStep];
    const isStart = room.room_id === floor.start_room;
    const widest = !isStart && room.doors.length ? room.doors.reduce((a, b) => (b.clear_in_est > a.clear_in_est ? b : a)) : null;
    const door = widest ? (floor.doors.find((d) => samePoint(d.center, widest.center)) ?? null) : null;
    const spareIn = door ? Math.round((door.clear_in_est - unit.chair_in[0]) * 10) / 10 : null;
    return { room, kind: "arrive", route, drawnFrom: null, door, shortfallIn: null, spareIn, enginePath: Boolean(room.path?.length) };
  }

  if (room.status === "unknown" || room.doors.length === 0) {
    return { room, kind: "no-door", route: base.slice(0, 1), drawnFrom: null, door: null, shortfallIn: null };
  }

  // blocked: the reason names the widest door; that is the one we stop at
  const widest = room.doors.reduce((a, b) => (b.clear_in_est > a.clear_in_est ? b : a));
  const door = floor.doors.find((d) => samePoint(d.center, widest.center)) ?? null;
  if (!door || door.passable || base.length === 0) {
    // the widest door fits but the route is too tight (or the door can't be matched)
    return { room, kind: "tight", route: base, drawnFrom: null, door, shortfallIn: null };
  }

  const [chairW, chairL] = unit.chair_in;
  const wall = floor.walls.find((w) => w.edge === door.edge);
  const along: Point = wall ? geom.unit(geom.sub(wall.b, wall.a)) : [1, 0];
  let n: Point = [-along[1], along[0]];
  const last = base[base.length - 1];
  const fromDoor = geom.sub([last[0], last[1]], door.center);
  if (fromDoor[0] * n[0] + fromDoor[1] * n[1] < 0) n = geom.mul(n, -1);
  // stop with the chair's leading edge a few cm short of the door line, length axis through the door
  const stop = geom.add(door.center, geom.mul(n, (chairL * M_PER_IN) / 2 + 0.06));
  const theta = normHeading(Math.atan2(n[1], n[0]));
  const route: PathStep[] = [...base, [stop[0], stop[1], theta]];
  const shortfallIn = Math.round((chairW - door.clear_in_est) * 10) / 10;
  return { room, kind: "blocked", route, drawnFrom: base.length - 1, door, shortfallIn };
}

/** Heading folded into [0, π). */
export function normHeading(t: number): number {
  const m = t % Math.PI;
  return m < 0 ? m + Math.PI : m;
}

/** Shortest turn between two headings that repeat every π. */
function lerpHeading(a: number, b: number, f: number): number {
  let d = normHeading(b) - normHeading(a);
  if (d > Math.PI / 2) d -= Math.PI;
  if (d < -Math.PI / 2) d += Math.PI;
  return normHeading(a + d * f);
}

export interface RouteSampler {
  length: number;
  /** pose at progress p ∈ [0, 1] by arc length */
  at: (p: number) => PathStep;
  /** arc-length progress at which route index i is reached */
  progressAt: (i: number) => number;
}

/** metres of travel a full radian of turning is worth on the timeline, so turns in place take time */
const TURN_M_PER_RAD = 0.25;

/** heading change between two headings that repeat every π, radians in [0, π/2] */
function turnBetween(a: number, b: number): number {
  const d = Math.abs(normHeading(b) - normHeading(a));
  return Math.min(d, Math.PI - d);
}

export function sampler(route: PathStep[]): RouteSampler {
  // progress runs on travel plus weighted turning: the engine's path turns in place
  // (same x,y, new heading), and those steps must be animated, not skipped
  const cum = [0];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]) + TURN_M_PER_RAD * turnBetween(a[2], b[2]));
  }
  const length = cum[cum.length - 1] ?? 0;
  return {
    length,
    progressAt: (i) => (length === 0 ? 1 : cum[Math.max(0, Math.min(i, cum.length - 1))] / length),
    at: (p) => {
      if (route.length === 0) return [0, 0, 0];
      if (route.length === 1 || length === 0) return route[route.length - 1];
      const s = Math.max(0, Math.min(1, p)) * length;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const seg = cum[i] - cum[i - 1];
      const f = seg === 0 ? 1 : (s - cum[i - 1]) / seg;
      const a = route[i - 1];
      const b = route[i];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, lerpHeading(a[2], b[2], f)];
    },
  };
}
