"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type Scenario = "scanned" | "hinges";

/** "As scanned / With offset hinges": the before/after switch on the plan. */
export function ScenarioToggle({ value, onChange, disabled }: { value: Scenario; onChange: (s: Scenario) => void; disabled?: boolean }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as Scenario)}
      spacing={0}
      aria-label="Scenario"
      disabled={disabled}
      className="border border-ink"
    >
      {(
        [
          ["scanned", "As scanned"],
          ["hinges", "With offset hinges"],
        ] as const
      ).map(([v, label]) => (
        <ToggleGroupItem
          key={v}
          value={v}
          className="h-10 rounded-none px-4 text-sm font-semibold text-ink transition-colors transition-draft hover:bg-paper-deep data-[state=on]:bg-ink data-[state=on]:text-paper"
        >
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
