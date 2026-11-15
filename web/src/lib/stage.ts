/**
 * The stage's shared vocabulary: its steps, and how the city is laid out on the table.
 * World units are metres near the chair and the apartment; the field of units is laid out at
 * FIELD_M_PER_KM world units per kilometre around the medical center, which sits at the origin.
 */
export type Step = "chair" | "search" | "apartment";

export const STEPS: { id: Step; label: string }[] = [
  { id: "chair", label: "Chair" },
  { id: "search", label: "Search" },
  { id: "apartment", label: "Apartment" },
];

/** world units per km in the field of units (a drawing scale, not a measurement) */
export const FIELD_M_PER_KM = 4;

/**
 * Equirectangular position of a lat/lon relative to an origin, in km east and km north.
 * Good to well under 1% over the 20 km the batch covers; no map tiles, so it works offline.
 */
export function kmFrom(origin: { lat: number; lon: number }, p: { lat: number; lon: number }): [number, number] {
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  return [(p.lon - origin.lon) * kmPerDegLon, (p.lat - origin.lat) * kmPerDegLat];
}

/** km east / north → three.js world position on the table (x east, -z north) */
export function fieldPoint([e, n]: [number, number]): [number, number, number] {
  return [e * FIELD_M_PER_KM, 0, -n * FIELD_M_PER_KM];
}

export type ChairIn = [number, number];

/**
 * The chair the stage starts with: the demo profile (the size the batch was ranked for and the
 * recorded run remembers), shown as "your chair". The sourced presets are in lib/presets.ts.
 */
export const START_CHAIR: ChairIn = [27, 42];

export const CHAIR_LIMITS = { width: [18, 36], length: [20, 56] } as const;

/** the turning space the engine checks bathrooms against (walls only), inches */
export const TURNING_IN = 60;

/** the circle the footprint sweeps turning in place about its centre: its diagonal, inches */
export const sweptIn = ([w, l]: ChairIn) => Math.hypot(w, l);
