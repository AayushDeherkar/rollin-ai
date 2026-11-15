/**
 * Types for the engine output, mirroring contracts/unit_result.example.json (PLAN.md §5).
 * Field names must match the shared contract exactly. Coordinates are metres, model frame.
 */

export type Point = [number, number];
/** chair centre x, y (metres) and heading theta (radians) */
export type PathStep = [number, number, number];

export type RoomStatus = "reachable" | "blocked" | "unknown";

export interface Wall {
  edge: string;
  type: string;
  thickness: number;
  a: Point;
  b: Point;
}

export interface Door {
  edge: string;
  type: string;
  width_in: number;
  /** clear width is an engine estimate (opening minus leaf and stop) — always label "est." */
  clear_in_est: number;
  passable: boolean;
  center: Point;
}

export interface RoomDoor {
  type: string;
  width_in: number;
  clear_in_est: number;
  center: Point;
}

export interface TurningSpace {
  max_circle_in: number;
  meets_60in: boolean;
  walls_only: boolean;
  /** centre of the largest circle, metres, model frame (contract v2) */
  center?: Point | null;
}

export interface Room {
  room_id: string;
  label: string;
  area_m2: number;
  status: RoomStatus;
  reason?: string | null;
  doors: RoomDoor[];
  turning_space: TurningSpace | null;
  /** reachable: the drive into the room; blocked: the drive up to the door that stops the chair (contract v2) */
  path: PathStep[] | null;
  polygon: Point[];
  /** the `edge` of the door where the chair stops on its way to a blocked room, possibly a room on the way (contract v2) */
  blocking_door_edge?: string | null;
  /** "asked" once the leasing office answered about a room the scan left unknown; `status` stays unknown (round 5) */
  basis?: string;
  answer?: RoomAnswer;
}

/** A leasing office's answer about an unknown room (round 5): a width only when written in inches. */
export interface RoomAnswer {
  clear_in: { value: number | null; unit?: string; basis: string; source?: string };
  said?: string;
  answer_id?: string;
  answered_at?: string;
}

export interface Artifact {
  edge: string;
  width_in: number;
}

export interface Floor {
  floor: string;
  start_room: string;
  walls: Wall[];
  doors: Door[];
  artifacts: Artifact[];
  openings_found: number;
  artifacts_ignored: number;
  rooms: Room[];
}

export interface UnitResult {
  model: string;
  name: string;
  /** [width, length] in inches */
  chair_in: [number, number];
  scenario: string;
  floors: Floor[];
}

export interface StatusCounts {
  reachable: number;
  blocked: number;
  unknown: number;
}

export function countRooms(unit: UnitResult): StatusCounts {
  const counts: StatusCounts = { reachable: 0, blocked: 0, unknown: 0 };
  for (const floor of unit.floors) {
    for (const room of floor.rooms) counts[room.status] += 1;
  }
  return counts;
}

/** One row of GET /api/units (contracts/units_list.example.json). */
export interface UnitRow {
  sid: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
  score: number;
  counts: StatusCounts;
  summary: string;
  chair_in: [number, number];
  scenario: string;
  distance_km?: number | null;
  with_hinges?: { score: number; counts: StatusCounts; summary: string } | null;
  usable?: boolean;
  synthetic?: boolean;
}

/** GET /api/units */
export interface UnitsList {
  query: { lat: number; lon: number; radius_km: number | null; beds: number | null; w: number; l: number; hinges: boolean };
  total: number;
  units: UnitRow[];
  source: { kind: string; updated_at?: string | null; processed?: number | null; no_data?: number | null };
}

/** Where a response came from: the live API, or the contract fixtures replayed when it is not reachable. */
export type Origin = "live" | "replay";
export const ORIGIN_HEADER = "x-rollin-origin";
export const REPLAY_REASON_HEADER = "x-rollin-replay-reason";
