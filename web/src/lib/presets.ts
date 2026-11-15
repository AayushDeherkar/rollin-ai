/**
 * Sourced chair sizes for step 1 (data/chair_presets.json, which GET /api/insights serves).
 * Width is occupied width (the chair with its user), length the device. Every preset carries its
 * source; the bundled copy is the same file, used until /api/insights answers.
 */
import { useEffect, useState } from "react";
import presetsJson from "../../../data/chair_presets.json";

export interface PresetSource {
  title: string;
  url?: string;
  checked?: string;
}
export interface SourcedPreset {
  name: string;
  width_in: number;
  length_in: number;
  source: PresetSource;
}

/** Only well-formed presets with a source; anything else is dropped, never filled in. */
export function parsePresets(x: unknown): SourcedPreset[] | null {
  if (!Array.isArray(x)) return null;
  const ok = x.filter(
    (p): p is SourcedPreset =>
      typeof p?.name === "string" &&
      Number.isFinite(p?.width_in) &&
      Number.isFinite(p?.length_in) &&
      typeof p?.source?.title === "string" &&
      p.source.title.length > 0,
  );
  return ok.length ? ok : null;
}

/**
 * The file names a report once and then says "Same report, …"; each preset's source is shown on
 * its own, so "Same report" is replaced with the report named by the preset before it.
 */
export function namedSources(presets: SourcedPreset[]): SourcedPreset[] {
  let report: string | null = null;
  return presets.map((p) => {
    const t = p.source.title;
    if (/^same report\b/i.test(t) && report) return { ...p, source: { ...p.source, title: t.replace(/^same report/i, report) } };
    const cut = t.search(/, fig\.?\s/i);
    if (cut > 0) report = t.slice(0, cut);
    return p;
  });
}

export const BUNDLED_PRESETS: SourcedPreset[] = namedSources(parsePresets(presetsJson.presets) ?? []);

export function useSourcedPresets(): SourcedPreset[] {
  const [presets, setPresets] = useState(BUNDLED_PRESETS);
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/insights", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { presets?: unknown } | null) => {
        const p = parsePresets(b?.presets);
        if (p && !ac.signal.aborted) setPresets(namedSources(p));
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);
  return presets;
}

/** A short name for a button: "Power wheelchair (95th percentile)" → "Power, 95th percentile". */
export function shortName(name: string): string {
  const m = /^(\w+) wheelchair \((.+)\)$/i.exec(name);
  return m ? `${m[1]}, ${m[2].replace(/ user$/, "")}` : name;
}
