import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PanelState = "loading" | "empty" | "ready";

/** One region of the drawing sheet: a heading on a rule, then the drawing area. */
export function Panel({
  title,
  tag,
  aside,
  children,
  className,
  labelledBy,
}: {
  title: string;
  /** a short caveat beside the title (e.g. replayed data) */
  tag?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <header className="flex min-h-16 shrink-0 items-end justify-between gap-4 border-b border-rule-strong px-5 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id={labelledBy} className="display shrink-0 text-2xl font-semibold">
            {title}
          </h2>
          {tag}
        </div>
        {aside}
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** Shared empty-state block: a line of direction, never a mood. */
export function EmptyNote({ title, children, figure }: { title: string; children: ReactNode; figure?: ReactNode }) {
  return (
    <div className="flex h-full flex-col justify-center gap-4 px-6 py-8">
      {figure}
      <p className="display text-xl font-semibold">{title}</p>
      <div className="max-w-sm text-base text-ink-soft">{children}</div>
    </div>
  );
}
