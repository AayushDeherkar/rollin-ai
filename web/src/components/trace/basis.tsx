import { Calculator, CircleHelp, MessageCircle, Pin, Ruler, type LucideIcon } from "lucide-react";
import type { Basis, Num } from "@/lib/agent-events";
import { cn } from "@/lib/utils";

/**
 * How we know a number. Each basis has its own icon, word and border, so it reads without colour:
 * measured is solid ink, estimated dashed, assumed dotted, asked carries a speech mark, unknown is grey.
 */
const BASIS: Record<Basis, { word: string; icon: LucideIcon; className: string }> = {
  measured: { word: "measured", icon: Ruler, className: "border-solid border-ink text-ink" },
  estimated: { word: "est.", icon: Calculator, className: "border-dashed border-ink-soft text-ink-soft" },
  assumed: { word: "assumed", icon: Pin, className: "border-dotted border-ink-soft text-ink-soft" },
  asked: { word: "asked", icon: MessageCircle, className: "border-solid border-ink-soft text-ink-soft" },
  unknown: { word: "unknown", icon: CircleHelp, className: "border-solid border-unknown bg-unknown-wash text-unknown" },
};

export function BasisChip({ basis, source }: { basis: Basis; source?: string }) {
  const b = BASIS[basis] ?? BASIS.unknown;
  const Icon = b.icon;
  const word = basis === "asked" && source ? `asked ${source}` : b.word;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 border px-1.5 text-sm leading-6 font-medium whitespace-nowrap", b.className)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {word}
    </span>
  );
}

/** A number as the agent gave it: figure, unit, and its basis. An unknown has no figure. */
export function NumValue({ n }: { n: Num }) {
  const figure = n.value === null ? null : Number.isInteger(n.value) ? String(n.value) : n.value.toFixed(1);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {figure !== null && (
        <span className="measure font-medium">
          {figure}
          {n.unit ? ` ${n.unit}` : ""}
        </span>
      )}
      <BasisChip basis={n.basis} source={n.source} />
    </span>
  );
}

/** "door_width" → "Door width" */
export function humanize(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
