"use client";

import { useId } from "react";
import { CHAIR_LIMITS, PRESETS, TURNING_IN, sweptIn, type ChairIn } from "@/lib/stage";
import { cn } from "@/lib/utils";

/**
 * Step 1's controls, bottom-left over the scene: presets, width and length, what the rings on
 * the floor mean, and the one primary action.
 */
export function ChairPlate({ chair, onChair, onFind }: { chair: ChairIn; onChair: (c: ChairIn) => void; onFind: () => void }) {
  const preset = PRESETS.find((p) => p.chair[0] === chair[0] && p.chair[1] === chair[1])?.id ?? null;
  return (
    <section aria-labelledby="chair-title" className="pointer-events-auto flex w-[480px] flex-col gap-5 border border-rule-strong bg-paper-lift p-6">
      <div className="flex flex-col gap-1">
        <h1 id="chair-title" className="display text-2xl font-bold">
          Size your chair
        </h1>
        <p className="text-base text-ink-soft">Rollin’ drives this footprint through every apartment’s measured doors.</p>
      </div>
      <div role="group" aria-label="Start from" className="flex gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => onChair(p.chair)}
            className={cn(
              "h-10 flex-1 border px-2 text-base font-semibold whitespace-nowrap transition-colors transition-draft",
              preset === p.id ? "border-ink bg-paper-deep text-ink" : "border-rule-strong text-ink-soft hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Slider label="Width" value={chair[0]} range={CHAIR_LIMITS.width} onChange={(w) => onChair([w, chair[1]])} />
        <Slider label="Length" value={chair[1]} range={CHAIR_LIMITS.length} onChange={(l) => onChair([chair[0], l])} />
        <p className="text-sm text-ink-soft">Preset sizes are starting points, not measurements. Set your own chair’s width and length.</p>
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
            The <span className="measure">{TURNING_IN} in</span> turning space every room is checked for.
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
