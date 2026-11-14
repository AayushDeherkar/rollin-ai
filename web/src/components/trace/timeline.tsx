"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import { CircleCheck, CircleDot, Flag, History, ListChecks, Satellite, ShieldCheck, Square, Wrench, type LucideIcon } from "lucide-react";
import type { AgentEvent, ApprovalEvent, FinalEvent, FindingEvent, PlanEvent, ToolEvent, VerifyEvent } from "@/lib/agent-events";
import { isNum } from "@/lib/agent-events";
import type { Decision } from "@/lib/agent";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { STATUS, StatusIcon } from "@/components/sheet/status";
import { ApprovalCard } from "./approval-card";
import { BasisChip, NumValue, humanize } from "./basis";
import { AerialCard, ProfileLine, VisionFindings, aerialSrc } from "./evidence";

export interface Evidence {
  eventId: string;
  sid: string;
  roomId: string;
  /** the finding came from a fit with offset hinges */
  hinges: boolean;
}

/**
 * The agent's run as a numbered sequence of steps (it is one), newest at the foot.
 * Findings open their evidence on the plan; the approval card is the only way anything is sent.
 */
export function Timeline({
  events,
  decisions,
  onDecide,
  onEvidence,
  shownEvidence,
}: {
  events: AgentEvent[];
  decisions: Record<string, Decision>;
  onDecide: (actionId: string, approved: boolean) => void;
  onEvidence: (e: Evidence) => void;
  shownEvidence: string | null;
}) {
  // which scenario each unit was last fitted under, so a finding opens the plan it came from
  const fitHinges: Record<string, boolean> = {};
  const reduce = useReducedMotionConfig();
  return (
    <ol className="flex flex-col">
      {events.map((ev, i) => {
        if (ev.type === "tool") {
          const t = ev as ToolEvent;
          const sid = typeof t.args?.sid === "string" ? t.args.sid : null;
          if (t.name === "run_fit" && sid) fitHinges[sid] = t.args?.hinges === true;
        }
        // read now: Step renders after this loop ends, when later fits have changed the map
        const sid = "sid" in ev && typeof ev.sid === "string" ? ev.sid : null;
        // a finding that names its fit (contract v2) says which; otherwise the unit's last fit before it
        const scenario = "scenario" in ev && typeof ev.scenario === "string" ? ev.scenario : null;
        const hinges = scenario ? scenario.includes("hinges") : sid ? (fitHinges[sid] ?? false) : false;
        return (
          <motion.li
            key={`${ev.run_id}:${ev.id}:${i}`}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DUR[2], ease: EASE_DRAFT }}
            className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-b border-rule px-4 py-3.5"
          >
            <span className="measure pt-0.5 text-right text-sm text-ink-soft">{i + 1}</span>
            <div className="flex min-w-0 flex-col gap-2">
              <Step ev={ev} decisions={decisions} onDecide={onDecide} onEvidence={onEvidence} shownEvidence={shownEvidence} hinges={hinges} />
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

function Title({ icon: Icon, children, className }: { icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-base leading-snug font-semibold", className)}>
      <Icon aria-hidden className="size-5 shrink-0" strokeWidth={2.25} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Step({
  ev,
  decisions,
  onDecide,
  onEvidence,
  shownEvidence,
  hinges,
}: {
  ev: AgentEvent;
  decisions: Record<string, Decision>;
  onDecide: (actionId: string, approved: boolean) => void;
  onEvidence: (e: Evidence) => void;
  shownEvidence: string | null;
  /** whether the last fit of this event's unit before it used offset hinges */
  hinges: boolean;
}) {
  switch (ev.type) {
    case "plan": {
      const p = ev as PlanEvent;
      return (
        <>
          <Title icon={ListChecks}>Plan</Title>
          <p className="text-base">{p.text}</p>
          {p.profile && <ProfileLine profile={p.profile} />}
          {p.todos && p.todos.length > 0 && (
            <ul className="flex flex-col gap-1">
              {p.todos.map((t) => {
                const done = t.status === "completed" || t.status === "done";
                const Icon = done ? CircleCheck : t.status === "in_progress" ? CircleDot : Square;
                return (
                  <li key={t.id} className={cn("flex items-start gap-2 text-sm", done ? "text-ink-soft" : "text-ink")}>
                    <Icon aria-hidden className="mt-1 size-4 shrink-0" strokeWidth={2.25} />
                    <span>
                      {t.text}
                      <span className="sr-only"> ({t.status.replace("_", " ")})</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      );
    }
    case "tool": {
      const t = ev as ToolEvent;
      return (
        <>
          <Title icon={Wrench}>
            <span className="measure">{t.name}</span>
            {t.status && t.status !== "done" && <span className="ml-2 font-normal text-ink-soft">{t.status}</span>}
          </Title>
          <Fields label="In" data={t.args} />
          <Fields label="Out" data={t.result} />
        </>
      );
    }
    case "finding":
    case "aerial": {
      const f = ev as FindingEvent;
      const status = f.status && f.status in STATUS ? f.status : null;
      const canShow = Boolean(f.sid && f.room_id);
      const evidence: Evidence | null = canShow ? { eventId: f.id, sid: f.sid!, roomId: f.room_id!, hinges } : null;
      const body = (
        <>
          <span className={cn("flex items-center gap-2 text-base leading-snug font-semibold", status && STATUS[status].text)}>
            {ev.type === "aerial" ? <Satellite aria-hidden className="size-5 shrink-0" strokeWidth={2.25} /> : status ? <StatusIcon status={status} /> : null}
            <span className="min-w-0">
              {f.room ?? (ev.type === "aerial" ? "From aerial" : "Finding")}
              {status && <span className="font-normal">, {STATUS[status].word.toLowerCase()}</span>}
            </span>
          </span>
          <span className="text-base text-ink">{f.text}</span>
          {f.numbers && Object.keys(f.numbers).length > 0 && (
            <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-sm text-ink">
              {Object.entries(f.numbers).map(([k, n]) => (
                <span key={k} className="contents">
                  <span className="text-ink-soft">{humanize(k)}</span>
                  <NumValue n={n} />
                </span>
              ))}
            </span>
          )}
          {ev.type === "aerial" && aerialSrc(f.sid, f.image_url) && <AerialCard src={aerialSrc(f.sid, f.image_url)!} label={f.label} source={f.source} />}
          {f.findings && <VisionFindings findings={f.findings} />}
          {evidence && <span className="text-sm font-semibold text-ink underline decoration-rule-strong underline-offset-4">Show on the plan</span>}
        </>
      );
      return evidence ? (
        <button
          type="button"
          aria-pressed={shownEvidence === evidence.eventId}
          onClick={() => onEvidence(evidence)}
          className="-mx-2 flex flex-col gap-2 border border-transparent px-2 py-1.5 text-left transition-colors transition-draft hover:bg-paper-deep aria-pressed:border-ink aria-pressed:bg-paper-deep"
        >
          {body}
        </button>
      ) : (
        <div className="flex flex-col gap-2">{body}</div>
      );
    }
    case "verify": {
      const v = ev as VerifyEvent;
      return (
        <>
          <Title icon={ShieldCheck}>Checked each claim</Title>
          <ul className="flex flex-col gap-1.5">
            {v.checked.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span>{c.claim}</span>
                <BasisChip basis={c.basis} />
                {c.note && <span className="text-ink-soft">{c.note}</span>}
              </li>
            ))}
          </ul>
          {v.questions && v.questions.length > 0 && (
            <>
              <p className="text-sm font-semibold">Unknowns become questions</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {v.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </>
          )}
        </>
      );
    }
    case "approval_needed": {
      const a = ev as ApprovalEvent;
      return <ApprovalCard event={a} decision={decisions[a.action_id] ?? null} onDecide={onDecide} />;
    }
    case "final": {
      const f = ev as FinalEvent;
      return (
        <>
          <Title icon={Flag}>Done</Title>
          {f.text && <p className="text-base">{f.text}</p>}
        </>
      );
    }
    case "memory": {
      // what the agent remembers about this sender between messages (profile memory)
      const all = ev as AgentEvent & Record<string, unknown>;
      const text = all.text;
      const rest = Object.fromEntries(Object.entries(all).filter(([k]) => !["id", "ts", "run_id", "type", "replay", "text"].includes(k)));
      return (
        <>
          <Title icon={History}>Memory</Title>
          {typeof text === "string" && <p className="text-base">{text}</p>}
          <Fields label="Kept" data={rest} />
        </>
      );
    }
    default:
      return (
        <>
          <Title icon={CircleDot}>{humanize(ev.type)}</Title>
          {"text" in ev && typeof ev.text === "string" && <p className="text-base">{ev.text}</p>}
        </>
      );
  }
}

/** Tool arguments or results, flattened: plain values as text, wrapped numbers with their basis. */
function Fields({ label, data }: { label: string; data?: Record<string, unknown> }) {
  if (!data) return null;
  const rows: { key: string; node: React.ReactNode }[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (isNum(v)) rows.push({ key: prefix, node: <NumValue n={v} /> });
    else if (Array.isArray(v))
      rows.push({
        key: prefix,
        node: <span className="measure">{v.length} items</span>,
      });
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix} ${k}` : k, x);
    else if (typeof v === "boolean") rows.push({ key: prefix, node: <span>{v ? "yes" : "no"}</span> });
    else if (v !== null && v !== undefined)
      rows.push({
        key: prefix,
        node: <span className="measure break-all">{String(v)}</span>,
      });
  };
  walk("", data);
  if (rows.length === 0) return null;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-sm">
      {rows.map((r, i) => (
        <span key={r.key + i} className="contents">
          <span className="text-ink-soft">
            {i === 0 ? `${label}: ` : ""}
            {humanize(r.key)}
          </span>
          {r.node}
        </span>
      ))}
    </div>
  );
}
