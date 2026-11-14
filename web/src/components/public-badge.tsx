import { PUBLIC_LABEL, PUBLIC_REPLAY } from "@/lib/public";
import { cn } from "@/lib/utils";

/** The public build's standing label: everything on screen is the synthetic replay. */
export function PublicBadge({ className }: { className?: string }) {
  if (!PUBLIC_REPLAY) return null;
  return (
    <p role="note" className={cn("pointer-events-auto border border-ink bg-paper-lift px-4 py-2 text-base font-semibold whitespace-nowrap", className)}>
      {PUBLIC_LABEL}
    </p>
  );
}
