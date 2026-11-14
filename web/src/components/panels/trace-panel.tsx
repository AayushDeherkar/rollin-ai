"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotionConfig } from "motion/react";
import { CircleStop, Play } from "lucide-react";
import type { Decision, Run } from "@/lib/agent";
import type { FinalEvent } from "@/lib/agent-events";
import { ReplayTag } from "@/components/sheet/replay-tag";
import { Timeline, type Evidence } from "@/components/trace/timeline";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { EmptyNote, Panel, type PanelState } from "@/components/sheet/panel";

/**
 * Agent trace (PLAN.md §7.3, right panel): the live run from POST /api/chat, step by step.
 * The cobalt accent appears here only while the agent is acting.
 */
export function TracePanel({
  state,
  run,
  decisions,
  acting,
  defaultMessage,
  onRun,
  onStop,
  onDecide,
  onEvidence,
  shownEvidence,
}: {
  state: PanelState;
  run: Run;
  decisions: Record<string, Decision>;
  acting: boolean;
  defaultMessage: string;
  onRun: (message: string) => void;
  onStop: () => void;
  onDecide: (actionId: string, approved: boolean) => void;
  onEvidence: (e: Evidence) => void;
  shownEvidence: string | null;
}) {
  const [message, setMessage] = useState(defaultMessage);
  const scroller = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionConfig();
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [run.events.length, reduce]);

  const final = run.events.findLast((e) => e.type === "final") as FinalEvent | undefined;
  const waiting = (final?.awaiting_approval ?? []).some((id) => decisions[id]?.state !== "done");
  const aside =
    state === "loading" || acting ? (
      <AgentActive />
    ) : run.status === "idle" ? null : (
      <span role="status" className="text-base font-semibold text-ink-soft">
        {run.status === "error" ? "Stopped by an error" : run.status === "stopped" ? "Stopped" : waiting ? "Waiting for you" : "Finished"}
      </span>
    );

  return (
    <Panel
      title="Agent"
      labelledBy="trace-heading"
      tag={run.origin === "replay" ? <ReplayTag reason={run.reason} /> : null}
      aside={aside}
    >
      {state === "loading" && <TraceLoading />}
      {state === "empty" && <IdleNote />}
      {state === "ready" && (
        <div className="flex h-full flex-col">
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            {run.events.length === 0 && run.status === "running" && <TraceLoading />}
            {run.events.length === 0 && run.status !== "running" && <IdleNote />}
            {run.events.length > 0 && (
              <Timeline events={run.events} decisions={decisions} onDecide={onDecide} onEvidence={onEvidence} shownEvidence={shownEvidence} />
            )}
            {run.status === "error" && (
              <p role="alert" className="px-6 py-4 text-base font-semibold text-block">
                {run.error}
              </p>
            )}
          </div>
          <form
            className="flex shrink-0 flex-col gap-2 border-t border-rule-strong px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (run.status === "running") onStop();
              else if (message.trim()) onRun(message.trim());
            }}
          >
            <label htmlFor="agent-ask" className="text-sm text-ink-soft">
              Ask the agent
            </label>
            <textarea
              id="agent-ask"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="resize-none border border-rule-strong bg-paper-lift px-3 py-2 text-base leading-snug focus-visible:border-ink"
            />
            <button
              type="submit"
              className="flex h-10 items-center justify-center gap-2 bg-ink px-4 text-sm font-semibold text-paper transition-colors transition-draft hover:bg-ink-soft"
            >
              {run.status === "running" ? (
                <>
                  <CircleStop aria-hidden className="size-4" strokeWidth={2.25} /> Stop
                </>
              ) : (
                <>
                  <Play aria-hidden className="size-4" strokeWidth={2.25} /> {run.status === "idle" ? "Run the agent" : "Run again"}
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </Panel>
  );
}

function IdleNote() {
  return (
    <EmptyNote title="The agent hasn’t started">
      When it runs, each step lands here in order: its plan, the tools it calls, what it found, and any message it wants your
      approval to send. It never contacts anyone without that approval.
    </EmptyNote>
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
