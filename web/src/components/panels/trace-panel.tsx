"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { EmptyNote, Panel, type PanelState } from "@/components/sheet/panel";

/**
 * Agent trace (PLAN.md §7.3, right panel). Streams from /api/chat in task B5.
 * The cobalt accent appears here only while the agent is acting.
 */
export function TracePanel({ state }: { state: PanelState }) {
  return (
    <Panel title="Agent" labelledBy="trace-heading" aside={state === "loading" ? <AgentActive /> : null}>
      {state === "loading" && <TraceLoading />}
      {state === "empty" && (
        <EmptyNote title="The agent hasn’t started">
          When it runs, each step lands here in order: its plan, the tools it calls, what it found, and any message it wants
          your approval to send. It never contacts anyone without that approval.
        </EmptyNote>
      )}
      {state === "ready" && (
        <EmptyNote title="No run yet">Live agent runs will stream into this panel.</EmptyNote>
      )}
    </Panel>
  );
}

/** The accent, used for its one job: the agent is acting now. */
function AgentActive() {
  return (
    <span role="status" className="flex items-center gap-2 text-base font-semibold text-agent">
      <span className="relative flex size-3">
        <span className="absolute inset-0 rounded-full bg-agent motion-safe:animate-ping" />
        <span className="relative size-3 rounded-full bg-agent" />
      </span>
      Working
    </span>
  );
}

function TraceLoading() {
  const reduce = useReducedMotionConfig();
  const rows = [0.8, 0.6, 0.9, 0.5];
  return (
    <ol aria-busy="true" aria-label="Agent steps loading" className="flex flex-col gap-6 px-6 py-6">
      {rows.map((w, i) => (
        <li key={i} className="flex items-start gap-4">
          <span className="measure w-6 pt-0.5 text-sm text-ink-soft">{i + 1}</span>
          <span className="flex flex-1 flex-col gap-2">
            <motion.span
              className="block h-0.5 origin-left bg-agent"
              style={{ width: `${w * 100}%` }}
              initial={{ scaleX: reduce ? 1 : 0 }}
              animate={{ scaleX: 1 }}
              transition={reduce ? { duration: 0 } : { duration: DUR[4], ease: EASE_DRAFT, delay: i * DUR[2] }}
            />
            <span className="h-4 w-2/3 bg-paper-deep motion-safe:animate-pulse" />
          </span>
        </li>
      ))}
    </ol>
  );
}
