"use client";

import { deliveryOf, type DeliveredEvent } from "@/lib/outbox-events";
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, X } from "lucide-react";
import type { Decision, Run } from "@/lib/agent";
import type { SearchView } from "@/lib/search";
import { STATUS } from "@/components/sheet/status";
import { ApprovalCard } from "@/components/trace/approval-card";
import { Timeline, type Evidence } from "@/components/trace/timeline";
import { cn } from "@/lib/utils";

/** The one sentence saying what is happening now, bottom-left over the scene. */
export function Narration({ text, acting }: { text: string; acting: boolean }) {
  if (!text) return null;
  return (
    <p role="status" aria-live="polite" className="pointer-events-auto flex max-w-[64ch] items-start gap-3 border border-rule-strong bg-paper-lift px-5 py-3 text-lg">
      <span aria-hidden className={cn("mt-2 size-2.5 shrink-0 rounded-full", acting ? "bg-agent motion-safe:animate-pulse" : "bg-ink-soft")} />
      <span className="line-clamp-2">{text}</span>
    </p>
  );
}

/** The full trace, folded into a small pill top-right; it opens on click and closes on Esc. */
export function AgentPill({
  run,
  decisions,
  acting,
  steps,
  onDecide,
  onEvidence,
}: {
  run: Run;
  decisions: Record<string, Decision>;
  acting: boolean;
  steps: number;
  onDecide: (actionId: string, approved: boolean) => void;
  onEvidence: (e: Evidence) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (run.status === "idle") return null;
  const state =
    run.status === "running" ? "Agent working" : run.status === "error" ? "Agent stopped with an error" : run.status === "stopped" ? "Agent stopped" : "Agent finished";
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="agent-trace"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 items-center gap-2 border bg-paper-lift px-4 text-base font-semibold transition-colors transition-draft hover:bg-paper-deep",
          acting ? "border-agent text-agent" : "border-rule-strong text-ink",
        )}
      >
        <Bot aria-hidden className="size-5" strokeWidth={2.25} />
        {state}
        <span className="measure text-ink-soft">{steps} steps</span>
        {run.origin === "replay" && <span className="border border-ink-soft px-1.5 text-sm text-ink-soft">Replay</span>}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform transition-draft", open && "rotate-180")} strokeWidth={2.25} />
      </button>
      {open && (
        <section id="agent-trace" aria-label="Agent trace" className="flex max-h-[70vh] w-[440px] flex-col border border-rule-strong bg-paper-lift">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <h2 className="display text-lg font-semibold">What the agent did</h2>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the trace" className="flex size-9 items-center justify-center hover:bg-paper-deep">
              <X aria-hidden className="size-5" strokeWidth={2.25} />
            </button>
          </div>
          {run.origin === "replay" && (
            <p className="border-b border-rule px-4 py-2 text-sm text-ink-soft">{run.reason ? `Replay of a recorded run. ${run.reason}` : "Replay of a recorded run."}</p>
          )}
          <div className="min-h-0 overflow-y-auto px-4 py-3">
            <Timeline events={run.events} decisions={decisions} onDecide={onDecide} onEvidence={onEvidence} shownEvidence={null} />
          </div>
        </section>
      )}
    </div>
  );
}

/** The top three, as plates on the right with one line each; opening one flies into it. */
export function BestFits({ view, onOpen }: { view: SearchView; onOpen: (sid: string) => void }) {
  if (!view.shortlist.length) return null;
  return (
    <section aria-labelledby="best-title" className="pointer-events-auto flex w-[400px] flex-col gap-3">
      <div className="border border-rule-strong bg-paper-lift px-4 py-3">
        <h2 id="best-title" className="display text-xl font-bold">
          Best fits for your chair
        </h2>
        <p className="text-sm text-ink-soft">
          {view.fromAgent ? "The agent’s shortlist. Room counts are estimated." : "The agent sent no shortlist: these are the units it checked, most rooms reached first. Estimated."}
        </p>
      </div>
      <ol className="flex flex-col gap-3">
        {view.shortlist.map((u, i) => (
          <li key={u.sid}>
            <button
              type="button"
              onClick={() => onOpen(u.sid)}
              className="flex w-full items-start gap-3 border border-rule-strong bg-paper-lift p-4 text-left transition-colors transition-draft hover:border-ink hover:bg-paper-deep"
            >
              <span aria-hidden className="measure flex size-8 shrink-0 items-center justify-center border-2 border-ink text-base font-semibold">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-lg font-semibold">{u.name}</span>
                {u.reason && <span className="line-clamp-2 text-base text-ink-soft">{u.reason}</span>}
                {u.counts && (
                  <span className="flex gap-4 text-sm">
                    {(["reachable", "blocked", "unknown"] as const).map((k) => {
                      const S = STATUS[k];
                      return (
                        <span key={k} className="flex items-center gap-1.5" title={`${S.word} (estimated)`}>
                          <S.icon aria-hidden className={cn("size-4", S.text)} strokeWidth={2.5} />
                          <span className="measure">{u.counts![k]}</span>
                          <span className="sr-only">{S.word}</span>
                        </span>
                      );
                    })}
                  </span>
                )}
                <span className="text-sm font-semibold underline underline-offset-4">Open the apartment</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The approval question as a focused card over the scene: nothing is sent without "Send". */
export function ApprovalFocus({
  view,
  decisions,
  onDecide,
  onDismiss,
  delivered = [],
}: {
  view: SearchView;
  decisions: Record<string, Decision>;
  onDecide: (actionId: string, approved: boolean) => void;
  onDismiss: () => void;
  delivered?: DeliveredEvent[];
}) {
  const a = view.approval;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [a?.action_id]);
  if (!a) return null;
  const decision = decisions[a.action_id] ?? null;
  return (
    <div ref={ref} tabIndex={-1} className="pointer-events-auto flex w-[520px] flex-col gap-2 outline-none">
      <ApprovalCard event={a} decision={decision} onDecide={onDecide} delivery={decision?.state === "done" && !decision.result.replay ? deliveryOf(a.draft, delivered) : null} />
      {decision?.state === "done" && (
        <button type="button" onClick={onDismiss} className="h-10 self-start border border-rule-strong bg-paper-lift px-4 text-base font-semibold hover:bg-paper-deep">
          Close
        </button>
      )}
    </div>
  );
}

/** What the points mean: shape and colour together. */
export function FieldLegend({ acting }: { acting: boolean }) {
  const items: { label: string; draw: React.ReactNode }[] = [
    { label: "Every room reached", draw: <rect x="7" y="2" width="6" height="16" fill="var(--reach)" /> },
    { label: "A room is blocked", draw: <><rect x="7" y="9" width="6" height="9" fill="var(--block)" /><rect x="2" y="7" width="16" height="3" fill="var(--block)" /></> },
    { label: "A room not measured", draw: <circle cx="10" cy="10" r="6" fill="none" stroke="var(--unknown)" strokeWidth="2.5" /> },
    { label: "Not checked", draw: <ellipse cx="10" cy="15" rx="6" ry="2.5" fill="var(--unknown)" /> },
  ];
  // the accent shows only while the agent is acting
  if (acting) items.push({ label: "Checking now", draw: <rect x="7" y="6" width="6" height="12" fill="var(--agent)" /> });
  return (
    <ul aria-label="Legend" className="pointer-events-auto flex flex-col gap-1.5 border border-rule-strong bg-paper-lift px-4 py-3 text-sm">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0">
            {i.draw}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
