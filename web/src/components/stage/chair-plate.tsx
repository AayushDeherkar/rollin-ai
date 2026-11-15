"use client";

import { useId, useState } from "react";
import { CHAIR_LIMITS, TURNING_IN, sweptIn, type ChairIn } from "@/lib/stage";
import { shortName, useSourcedPresets, type SourcedPreset } from "@/lib/presets";
import { cn } from "@/lib/utils";

/**
 * Step 1's controls, bottom-left over the scene: sourced presets (the source of the one under the
 * pointer, or the one chosen, shown beneath them), width and length, what the rings on the floor
 * mean, and the one primary action.
 */
export function ChairPlate({ chair, onChair, onFind }: { chair: ChairIn; onChair: (c: ChairIn) => void; onFind: () => void }) {
  const presets = useSourcedPresets();
  const chosen = presets.find((p) => p.width_in === chair[0] && p.length_in === chair[1]) ?? null;
  const [hover, setHover] = useState<SourcedPreset | null>(null);
  const shown = hover ?? chosen;
  return (
    <section aria-labelledby="chair-title" className="pointer-events-auto flex w-[520px] flex-col gap-5 border border-rule-strong bg-paper-lift p-6">
      <div className="flex flex-col gap-1">
        <h1 id="chair-title" className="display text-2xl font-bold">
          Size your chair
        </h1>
        <p className="text-base text-ink-soft">Rollin’ drives this footprint through each apartment’s doorways.</p>
      </div>
      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Measured sizes" className="grid grid-cols-2 gap-2" onMouseLeave={() => setHover(null)}>
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={chosen?.name === p.name}
              aria-describedby="preset-source"
              onClick={() => onChair([p.width_in, p.length_in])}
              onMouseEnter={() => setHover(p)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
              className={cn(
                "flex h-14 flex-col items-start justify-center border px-3 text-left transition-colors transition-draft",
                chosen?.name === p.name ? "border-ink bg-paper-deep text-ink" : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink",
              )}
            >
              <span className="text-sm leading-tight font-semibold whitespace-nowrap">{shortName(p.name)}</span>
              <span className="measure text-sm leading-tight">
                {p.width_in.toFixed(1)} × {p.length_in.toFixed(1)} in
              </span>
            </button>
          ))}
        </div>
        <p id="preset-source" aria-live="polite" className="min-h-[3lh] text-sm text-ink-soft">
          {shown ? (
            <>
              <span className="text-ink">Source:</span> {shown.source.title}
              {shown.source.checked ? ` (checked ${shown.source.checked})` : ""}.{" "}
              {shown.source.url && (
                <a href={shown.source.url} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-4">
                  Open the source
                </a>
              )}
            </>
          ) : (
            "Your own size. Point at a measured size to see where it comes from."
          )}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Slider label="Width" value={chair[0]} range={CHAIR_LIMITS.width} onChange={(w) => onChair([w, chair[1]])} />
        <Slider label="Length" value={chair[1]} range={CHAIR_LIMITS.length} onChange={(l) => onChair([chair[0], l])} />
        <p className="text-sm text-ink-soft">Width is the chair with its user (what has to pass a door). Set your own chair’s width and length.</p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-start gap-3">
          <RingSwatch dashed={false} />
          <span>
            Turning in place it sweeps a <span className="measure">{sweptIn(chair).toFixed(1)} in</span> circle (computed from width and length).
          </span>
        </li>
        <li className="flex items-start gap-3">
          <RingSwatch dashed />
          <span className="text-ink-soft">
            The <span className="measure">{TURNING_IN} in</span> turning space bathrooms are checked for (walls only).
          </span>
        </li>
      </ul>
      <button
        type="button"
        onClick={onFind}
        className="h-12 bg-ink px-5 text-left text-lg font-semibold text-paper transition-colors transition-draft hover:bg-ink-soft"
      >
        Find where this fits
      </button>
    </section>
  );
}

function Slider({ label, value, range, onChange }: { label: string; value: number; range: readonly [number, number]; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-3">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={range[0]}
        max={range[1]}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full accent-ink"
      />
      <output htmlFor={id} className="measure text-right text-base">
        {value.toFixed(1)} in
      </output>
    </div>
  );
}

function RingSwatch({ dashed }: { dashed: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0">
      <circle cx="10" cy="10" r="8" fill="none" stroke={dashed ? "var(--ink-soft)" : "var(--ink)"} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
    </svg>
  );
}
