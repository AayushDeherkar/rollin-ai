import type { ReactNode } from "react";

/**
 * The drawing's title block, run along the foot of the sheet as on an architect's set:
 * project, what is drawn, for which chair, under which scenario, and where the data came from.
 */
export function TitleBlock({ cells }: { cells: { label: string; value: ReactNode; measure?: boolean }[] }) {
  return (
    <footer className="grid h-(--titleblock-h) grid-cols-[auto_repeat(4,minmax(0,1fr))] border-t-2 border-ink">
      <div className="flex items-center border-r border-rule-strong px-6">
        <span className="display text-3xl leading-none font-bold">Rollin’</span>
      </div>
      {cells.map((c) => (
        <div key={c.label} className="flex min-w-0 flex-col justify-center gap-0.5 border-r border-rule-strong px-5 py-2 last:border-r-0">
          <span className="text-sm text-ink-soft">{c.label}</span>
          <span className={c.measure ? "measure truncate text-base font-medium" : "truncate text-base font-semibold"}>{c.value}</span>
        </div>
      ))}
    </footer>
  );
}
