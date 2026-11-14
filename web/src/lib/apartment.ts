/**
 * What the apartment step says about a unit, computed from the engine's room statuses as scanned
 * and with offset hinges. Nothing is invented: a room the engine could not measure stays unknown,
 * and every width is the engine's estimate.
 */
import type { Floor, Room, RoomStatus, UnitResult } from "./contract";

export interface Verdict {
  total: number;
  reachable: number;
  /** blocked as scanned, reachable with offset hinges; null when there is no hinges result */
  fixable: number | null;
  /** not reachable even with offset hinges (blocked, or not measured): a question for the landlord; null when there is no hinges result */
  landlord: number | null;
  text: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function verdict(asScanned: Floor, hinges: Floor | null, withHinges: boolean): Verdict {
  const total = asScanned.rooms.length;
  const reachableScanned = asScanned.rooms.filter((r) => r.status === "reachable").length;
  if (!hinges) {
    // no hinges result: say so, never count rooms as fixable or as needing the landlord
    const rest = total - reachableScanned;
    const parts = [`${reachableScanned} of ${total} rooms reachable.`];
    if (rest) parts.push(`Offset hinges not checked for the other ${rest}.`);
    return { total, reachable: reachableScanned, fixable: null, landlord: null, text: parts.join(" ") };
  }
  const after = (r: Room): RoomStatus => hinges.rooms.find((h) => h.room_id === r.room_id)?.status ?? r.status;
  const fixable = asScanned.rooms.filter((r) => r.status === "blocked" && after(r) === "reachable").length;
  const landlord = asScanned.rooms.filter((r) => after(r) !== "reachable").length;
  const reachable = withHinges ? reachableScanned + fixable : reachableScanned;
  const parts = [`${reachable} of ${total} rooms reachable${withHinges && fixable ? " with offset hinges" : ""}.`];
  if (!withHinges && fixable) parts.push(`${fixable} fixable with offset hinges.`);
  if (landlord) parts.push(`${landlord} ${plural(landlord, "needs", "need")} the landlord.`);
  return { total, reachable, fixable, landlord, text: parts.join(" ") };
}

export type Fix = { kind: "none" } | { kind: "hinges" } | { kind: "landlord-door" } | { kind: "landlord-measure" } | { kind: "unchecked" };

/** The fix for a room, from its status as scanned and with offset hinges (null: no hinges result for it). */
export function fixFor(room: Room, hingesRoom: Room | null): Fix {
  if (room.status === "reachable") return { kind: "none" };
  if (room.status === "unknown") return { kind: "landlord-measure" };
  if (!hingesRoom) return { kind: "unchecked" };
  if (hingesRoom.status === "reachable") return { kind: "hinges" };
  if (hingesRoom.status === "unknown") return { kind: "landlord-measure" };
  return { kind: "landlord-door" };
}

/** A room's place in the model, for the camera: centroid and the larger side of its bounding box (metres). */
export function roomFrame(room: Room): { centre: [number, number]; size: number } {
  const xs = room.polygon.map((p) => p[0]);
  const ys = room.polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { centre: [(minX + maxX) / 2, (minY + maxY) / 2], size: Math.max(maxX - minX, maxY - minY, 1) };
}

export const isSynthetic = (unit: UnitResult) => unit.model.startsWith("synthetic");

/** GET /api/vision/{sid}: what a vision model saw in a defurnished panorama near a door or room. */
export interface VisionItem {
  kind: string;
  room_id?: string;
  room?: string;
  door_in?: number;
  pano_id: string;
  answers?: Record<string, { question?: string; answer?: string; note?: string }>;
  label?: string;
}
export interface VisionResult {
  sid: string;
  items: VisionItem[];
}
