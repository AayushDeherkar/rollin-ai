/**
 * Pure geometry for drawing a contract floor plan. Model frame is metres with y up;
 * the screen is pixels with y down, so `project` flips y.
 */
import type { Door, Floor, Point, Room } from "./contract";

export const M_PER_IN = 0.0254;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function floorBounds(floor: Floor): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of floor.walls) {
    xs.push(w.a[0], w.b[0]);
    ys.push(w.a[1], w.b[1]);
  }
  for (const r of floor.rooms) {
    for (const [x, y] of r.polygon) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export interface Projection {
  scale: number; // px per metre
  toScreen: (p: Point) => Point;
}

/** Fit the bounds into width × height px with a margin (px) for dimension lines and labels. */
export function makeProjection(b: Bounds, width: number, height: number, margin: number): Projection {
  const w = Math.max(b.maxX - b.minX, 1e-6);
  const h = Math.max(b.maxY - b.minY, 1e-6);
  const scale = Math.max(Math.min((width - 2 * margin) / w, (height - 2 * margin) / h), 1);
  const offX = (width - w * scale) / 2;
  const offY = (height - h * scale) / 2;
  return {
    scale,
    toScreen: ([x, y]) => [offX + (x - b.minX) * scale, offY + (b.maxY - y) * scale],
  };
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const len = (a: Point) => Math.hypot(a[0], a[1]);
const unit = (a: Point): Point => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

export interface WallSegment {
  a: Point;
  b: Point;
  thickness: number;
}

/**
 * Wall segments with a gap cut where a door sits on the same edge. Ends that meet
 * another wall (corners) are extended by half the thickness so corners close; ends
 * that face a door gap are not, so the drawn opening equals the measured width.
 * Draw the result with butt caps.
 */
export function wallSegments(floor: Floor): WallSegment[] {
  const out: WallSegment[] = [];
  for (const wall of floor.walls) {
    const dir = sub(wall.b, wall.a);
    const L = len(dir);
    if (L === 0) continue;
    const u = unit(dir);
    const ext = wall.thickness / 2;
    const at = (t: number) => add(wall.a, mul(u, t));
    // gaps as [t0, t1] along the wall, in metres from a
    const gaps = floor.doors
      .filter((d) => d.edge === wall.edge)
      .map((d) => {
        const t = (d.center[0] - wall.a[0]) * u[0] + (d.center[1] - wall.a[1]) * u[1];
        const half = (d.width_in * M_PER_IN) / 2;
        return [Math.max(0, t - half), Math.min(L, t + half)] as [number, number];
      })
      .sort((p, q) => p[0] - q[0]);
    // walk the wall: pieces between gaps; the outer ends (t=0, t=L) are corners
    let t = 0;
    let startIsCorner = true;
    for (const [g0, g1] of gaps) {
      if (g0 > t) out.push({ a: at(startIsCorner ? -ext : t), b: at(g0), thickness: wall.thickness });
      t = Math.max(t, g1);
      startIsCorner = false;
    }
    if (t < L) out.push({ a: at(startIsCorner ? -ext : t), b: at(L + ext), thickness: wall.thickness });
  }
  return out;
}

export function pointInPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Area-weighted centroid; falls back to the vertex mean for degenerate polygons. */
export function centroid(poly: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export interface DoorGeometry {
  door: Door;
  /** jamb positions (model frame) */
  j0: Point;
  j1: Point;
  /** unit normal pointing to the side the dimension line is drawn on */
  normal: Point;
}

/**
 * Where to draw a door's dimension: along its wall edge, offset to the outside of the
 * unit when the door is on an exterior wall, otherwise into the start room (where the
 * chair approaches from), otherwise to either side.
 */
export function doorGeometry(floor: Floor, door: Door): DoorGeometry {
  const wall = floor.walls.find((w) => w.edge === door.edge);
  const dir: Point = wall ? unit(sub(wall.b, wall.a)) : [1, 0];
  const half = (door.width_in * M_PER_IN) / 2;
  const j0 = add(door.center, mul(dir, -half));
  const j1 = add(door.center, mul(dir, half));
  const n: Point = [-dir[1], dir[0]];
  const probe = (k: number) => add(door.center, mul(n, 0.4 * k));
  const inAny = (p: Point) => floor.rooms.some((r) => pointInPolygon(p, r.polygon));
  const start = floor.rooms.find((r) => r.room_id === floor.start_room);
  let side = 1;
  if (!inAny(probe(1))) side = 1;
  else if (!inAny(probe(-1))) side = -1;
  else if (start && pointInPolygon(probe(-1), start.polygon)) side = -1;
  return { door, j0, j1, normal: mul(n, side) };
}

/** Rooms a door opens into (its centre lies on their boundary, within tolerance). */
export function roomsForDoor(floor: Floor, door: Door, tol = 0.05): Room[] {
  return floor.rooms.filter((r) =>
    r.polygon.some((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length];
      return distToSegment(door.center, p, q) <= tol;
    }),
  );
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (l2 === 0) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
  return len(sub(p, add(a, mul(ab, t))));
}

/** Readable text angle (degrees) for a screen-space direction: never upside down. */
export function readableAngle(a: Point, b: Point): number {
  let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return deg;
}

export const geom = { sub, add, mul, len, unit };
