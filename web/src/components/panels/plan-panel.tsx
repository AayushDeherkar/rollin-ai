"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotionConfig } from "motion/react";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EmptyNote, Panel, type PanelState } from "@/components/sheet/panel";

export function PlanPanel({
  state,
  title,
  aside,
  children,
  className,
}: {
  state: PanelState;
  className?: string;
  title: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Panel title={title} labelledBy="plan-heading" aside={state === "ready" ? aside : null} className={cn("bg-paper-lift", className)}>
      {state === "loading" && <PlanLoading />}
      {state === "empty" && (
        <EmptyNote title="Pick a unit to draw its plan" figure={<NorthArrow />}>
          The plan shows every wall and door the scan measured, which rooms your chair reaches, and the door that stops it.
        </EmptyNote>
      )}
      {state === "ready" && children}
    </Panel>
  );
}

/** Faint north arrow: the furniture of an empty drawing sheet. */
function NorthArrow() {
  return (
    <svg aria-hidden viewBox="0 -10 48 74" className="h-18 w-12 text-ink-soft">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="24" cy="32" r="18" />
        <path d="M24 12 L31 40 L24 34 L17 40 Z" fill="currentColor" />
      </g>
      <text x="24" y="10" textAnchor="middle" className="measure text-sm" fill="currentColor" dy="-1">N</text>
    </svg>
  );
}

/** Loading: construction lines drawn in, as a drafter would block out a plan. */
function PlanLoading() {
  const reduce = useReducedMotionConfig();
  const lines = ["M80 60 H520", "M80 60 V340", "M520 60 V340", "M80 340 H520", "M300 60 V340", "M80 200 H300"];
  return (
    <div aria-busy="true" className="flex h-full flex-col items-center justify-center gap-5 p-8">
      <svg aria-hidden viewBox="0 0 600 400" className="h-auto w-full max-w-xl">
        {lines.map((d, i) => (
          <motion.path
            key={d}
            d={d}
            fill="none"
            stroke="var(--rule-strong)"
            strokeWidth="2"
            initial={{ pathLength: reduce ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={
              reduce
                ? { duration: 0 }
                : { duration: DUR[4], ease: EASE_DRAFT, delay: i * DUR[1], repeat: Infinity, repeatType: "loop", repeatDelay: DUR[3] }
            }
          />
        ))}
      </svg>
      <p className="text-base text-ink-soft">Drawing the plan from the scan…</p>
    </div>
  );
}
