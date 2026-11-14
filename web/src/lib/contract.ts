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
}

export interface Room {
  room_id: string;
  label: string;
  area_m2: number;
  status: RoomStatus;
  reason?: string | null;
  doors: RoomDoor[];
  turning_space: TurningSpace | null;
  path: PathStep[] | null;
  polygon: Point[];
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
