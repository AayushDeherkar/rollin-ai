"use client";

import { Send, X } from "lucide-react";
import type { ApprovalEvent } from "@/lib/agent-events";
import { ALREADY_DECIDED, type Decision } from "@/lib/agent";

/**
 * The approval gate, drawn as a card the user must answer. Nothing is sent without "Send".
 * Ink, never the accent: asking is not acting. The result says plainly what happened.
 */
export function ApprovalCard({
  event,
  decision,
  onDecide,
}: {
  event: ApprovalEvent;
  decision: Decision | null;
  onDecide: (actionId: string, approved: boolean) => void;
}) {
  const sending = decision?.state === "sending";
  const decided = decision?.state === "done";
  return (
    <section
      aria-label="Approval needed"
      className="flex flex-col gap-3 border-2 border-ink bg-paper-lift p-3"
    >
      <p className="display text-xl leading-tight font-semibold">
        Send these questions to the leasing office?
      </p>
      {event.to?.label && (
        <p className="text-sm">
          <span className="text-ink-soft">To </span>
          <span className="font-semibold">{event.to.label}</span>
        </p>
      )}
      {event.draft && (
        <blockquote className="border-l-2 border-rule-strong pl-3 text-base">
          {event.draft}
        </blockquote>
      )}
      {event.reason && <p className="text-sm text-ink-soft">{event.reason}</p>}

      {!decided && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => onDecide(event.action_id, true)}
            className="flex h-10 items-center gap-2 bg-ink px-4 text-sm font-semibold text-paper transition-colors transition-draft hover:bg-ink-soft disabled:opacity-60"
          >
            <Send aria-hidden className="size-4" strokeWidth={2.25} />
            {sending && decision.approved ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            disabled={sending}
            onClick={() => onDecide(event.action_id, false)}
            className="flex h-10 items-center gap-2 border border-ink px-4 text-sm font-semibold transition-colors transition-draft hover:bg-paper-deep disabled:opacity-60"
          >
            <X aria-hidden className="size-4" strokeWidth={2.25} />
            Don’t send
          </button>
        </div>
      )}
      {decision?.state === "error" && (
        <p role="alert" className="text-sm font-semibold text-block">
          The decision did not go through: {decision.message}
        </p>
      )}
      {decided && (
        <p role="status" className="text-base font-semibold">
          {decision.result.replay
            ? "Not sent: this is a replayed run."
            : decision.result.status === ALREADY_DECIDED
              ? "This was already decided."
              : decision.result.approved
                ? capitalise(decision.result.status)
                : "Not sent. The agent will not contact them."}
        </p>
      )}
    </section>
  );
}

const capitalise = (s: string) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
