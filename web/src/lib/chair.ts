/**
 * The chair's drive through a plan, built from the contract (v2).
 *
 * Heading convention (engine/fit.py rect_kernel): theta rotates the chair's LENGTH axis
 * from +x in the model frame (y up). Headings live in [0, π): a rectangle has no front.
 *
 * Every route is the engine's own `path`: into a reachable room, or up to the door that stops
 * the chair for a blocked one. The blocking door is the one the engine names
 * (`blocking_door_edge`); nothing is drawn or matched by the UI.
 */
import type { Door, Floor, PathStep, Point, Room, UnitResult } from "./contract";
import { centroid, roomsForDoor } from "./plan-geometry";

export type DriveKind = "arrive" | "blocked" | "tight" | "no-door";

/** The door a drive is about: where the callout points, with its estimated clear width. */
export interface DriveDoor {
  center: Point;
  clear_in_est: number;
  /** wall edge id, for doors the engine named (blocked rooms) */
  edge: string | null;
}

export interface Drive {
  room: Room;
  kind: DriveKind;
  /** chair centre + heading, metres / radians, model frame */
  route: PathStep[];
  /** the door that stops the chair (kind "blocked"), or the widest way in (kind "arrive") */
  door: DriveDoor | null;
  /** when the stopping door belongs to a room on the way, not to the room itself */
  via: Room | null;
  /** chair width minus estimated clear width, inches (kind "blocked") */
  shortfallIn: number | null;
  /** for "arrive": spare clear width over the chair at the widest door, inches */
  spareIn?: number | null;
  /** true when the route is the engine's own `path` for this room (not a fallback point) */
  enginePath?: boolean;
}

const asDriveDoor = (d: Door): DriveDoor => ({ center: d.center, clear_in_est: d.clear_in_est, edge: d.edge });

/** The room the drive should open on: first blocked room the engine names a door for, else any blocked, else first non-start room. */
export function defaultTarget(floor: Floor): string | null {
  const blocked = floor.rooms.filter((r) => r.status === "blocked");
  const withDoor = blocked.find((r) => r.blocking_door_edge && r.path?.length);
  return (withDoor ?? blocked[0] ?? floor.rooms.find((r) => r.room_id !== floor.start_room) ?? null)?.room_id ?? null;
}

export function buildDrive(unit: UnitResult, floor: Floor, roomId: string): Drive | null {
  const room = floor.rooms.find((r) => r.room_id === roomId);
  if (!room) return null;
  const start = floor.rooms.find((r) => r.room_id === floor.start_room);
  const atStart: PathStep[] = start?.path?.length ? [start.path[0]] : start ? [[...centroid(start.polygon), 0] as PathStep] : [];
  const none = { door: null, via: null, shortfallIn: null } as const;

  if (room.status === "reachable") {
    const route = room.path?.length ? room.path : [[...centroid(room.polygon), 0] as PathStep];
    const isStart = room.room_id === floor.start_room;
    // the room's own door list carries each door's estimated clear width
    const widest = !isStart && room.doors.length ? room.doors.reduce((a, b) => (b.clear_in_est > a.clear_in_est ? b : a)) : null;
    const door = widest ? { center: widest.center, clear_in_est: widest.clear_in_est, edge: null } : null;
    const spareIn = door ? Math.round((door.clear_in_est - unit.chair_in[0]) * 10) / 10 : null;
    return { room, kind: "arrive", route, ...none, door, spareIn, enginePath: Boolean(room.path?.length) };
  }

  if (room.status === "unknown") {
    return { room, kind: "no-door", route: atStart, ...none };
  }

  // blocked: the engine names the door that stops the chair and drives up to it
  const named = room.blocking_door_edge ? (floor.doors.find((d) => d.edge === room.blocking_door_edge) ?? null) : null;
  if (!named || !room.path?.length || named.passable) {
    // no stopping door: the chair fits nowhere on the way (the reason says why)
    return { room, kind: "tight", route: room.path?.length ? room.path : atStart, ...none, door: named ? asDriveDoor(named) : null, enginePath: Boolean(room.path?.length) };
  }
  const sides = roomsForDoor(floor, named);
  const via = sides.some((r) => r.room_id === room.room_id) ? null : (sides.find((r) => r.status !== "reachable") ?? sides[0] ?? null);
  const shortfallIn = Math.round((unit.chair_in[0] - named.clear_in_est) * 10) / 10;
  return { room, kind: "blocked", route: room.path, door: asDriveDoor(named), via, shortfallIn, enginePath: true };
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
