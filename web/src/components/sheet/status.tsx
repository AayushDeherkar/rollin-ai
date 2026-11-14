import { Ban, Check, CircleHelp, type LucideIcon } from "lucide-react";
import type { RoomStatus } from "@/lib/contract";
import { cn } from "@/lib/utils";

/**
 * Every status is colour + pattern + icon + word, so it reads without colour vision
 * and on a washed-out projector.
 */
export const STATUS: Record<
  RoomStatus,
  { word: string; icon: LucideIcon; text: string; pattern: string }
> = {
  reachable: { word: "Reachable", icon: Check, text: "text-reach", pattern: "url(#fill-reach)" },
  blocked: { word: "Blocked", icon: Ban, text: "text-block", pattern: "url(#fill-block)" },
  unknown: { word: "Not measured", icon: CircleHelp, text: "text-unknown", pattern: "url(#fill-unknown)" },
};

export function StatusIcon({ status, className }: { status: RoomStatus; className?: string }) {
  const Icon = STATUS[status].icon;
  return <Icon aria-hidden className={cn("size-5 shrink-0", STATUS[status].text, className)} strokeWidth={2.25} />;
}

/** Small swatch showing the plan's fill pattern for a status (used in lists and legend). */
export function StatusSwatch({ status, className }: { status: RoomStatus; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn("size-5 shrink-0", className)}>
      <rect x="1" y="1" width="18" height="18" fill={STATUS[status].pattern} stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Hatch patterns shared by every SVG on the page. Rendered once, hidden.
 * reachable = flat wash, blocked = 45° redline hatch, unknown = graphite stipple.
 */
export function PatternDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <pattern id="fill-reach" patternUnits="userSpaceOnUse" width="8" height="8">
          <rect width="8" height="8" fill="var(--reach-wash)" />
        </pattern>
        <pattern id="fill-block" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="var(--block-wash)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--block)" strokeWidth="1.6" />
        </pattern>
        <pattern id="fill-unknown" patternUnits="userSpaceOnUse" width="7" height="7">
          <rect width="7" height="7" fill="var(--unknown-wash)" />
          <circle cx="3.5" cy="3.5" r="1" fill="var(--unknown)" />
        </pattern>
      </defs>
    </svg>
  );
}
