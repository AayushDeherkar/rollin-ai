"use client";

import Image from "next/image";
import Link from "next/link";
import { STEPS, type Step } from "@/lib/stage";
import { cn } from "@/lib/utils";

/**
 * The wordmark and the three steps, top-left over the scene. The steps are a real sequence,
 * so they are numbered; a step you cannot reach yet is shown but disabled.
 */
export function StepBar({ step, available, onStep }: { step: Step; available: Record<Step, boolean>; onStep: (s: Step) => void }) {
  return (
    <nav aria-label="Steps" className="pointer-events-auto flex items-center gap-6 border border-rule-strong bg-paper-lift py-2 pr-3 pl-5">
      <Link href="/" aria-label="Rollin’, home" className="shrink-0">
        <Image src="/logo.png" alt="" width={40} height={40} priority className="size-10" />
      </Link>
      <ol className="flex items-center">
        {STEPS.map((s, i) => {
          const current = s.id === step;
          const enabled = available[s.id];
          return (
            <li key={s.id} className="flex items-center">
              {i > 0 && <span aria-hidden className={cn("mx-1 h-px w-6", enabled ? "bg-ink-soft" : "bg-rule-strong")} />}
              <button
                type="button"
                disabled={!enabled}
                aria-current={current ? "step" : undefined}
                onClick={() => onStep(s.id)}
                className={cn(
                  "flex h-10 items-center gap-2 px-2 text-base font-semibold transition-colors transition-draft",
                  current ? "text-ink" : enabled ? "text-ink-soft hover:text-ink" : "text-ink-soft/50",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "measure flex size-7 items-center justify-center border text-sm",
                    current ? "border-ink bg-ink text-paper" : enabled ? "border-ink-soft" : "border-rule-strong",
                  )}
                >
                  {i + 1}
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
