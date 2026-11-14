/**
 * What the search step shows, read from the agent's events as they arrive: which units the
 * agent is checking, what each check found, one plain sentence for the current step, the
 * shortlist, and an approval waiting for an answer. Nothing here is invented: a unit the agent
 * never checked stays "not checked".
 */
import type { StatusCounts, UnitRow } from "./contract";
import { isNum, type AgentEvent, type ApprovalEvent, type FindingEvent, type Num, type ToolEvent } from "./agent-events";
import type { Run } from "./agent";

/**
 * A unit's point on the field, from the agent's as-scanned fit (run_fit):
 * reachable = every room reached; blocked = at least one room blocked; unknown = no room
 * blocked but at least one not measured.
 */
export type PointStatus = "unchecked" | "checking" | "reachable" | "blocked" | "unknown";

const val = (x: unknown): number | null => (isNum(x) ? (x as Num).value : typeof x === "number" ? x : null);

function countsOf(result: Record<string, unknown> | undefined): StatusCounts | null {
  const c = result?.counts as Record<string, unknown> | undefined;
  if (!c) return null;
  const r = val(c.reachable);
  const b = val(c.blocked);
  const u = val(c.unknown);
  if (r === null || b === null || u === null) return null;
  return { reachable: r, blocked: b, unknown: u };
}

export function statusOfCounts(c: StatusCounts): Exclude<PointStatus, "unchecked" | "checking"> {
  if (c.blocked > 0) return "blocked";
  if (c.unknown > 0) return "unknown";
  return "reachable";
}

export interface ShortItem {
  sid: string;
  name: string;
  reason: string;
  counts: StatusCounts | null;
}

export interface SearchView {
  status: Map<string, PointStatus>;
  /** as-scanned room counts from the agent's own fits */
  fits: Map<string, StatusCounts>;
  narration: string;
  shortlist: ShortItem[];
  /** true when the shortlist is the agent's; false when it is built from the units it checked */
  fromAgent: boolean;
  approval: ApprovalEvent | null;
  steps: number;
}

function sidsIn(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
}

/** One plain sentence for an event, or null to keep the previous one. */
function say(ev: AgentEvent, unitName: (sid: string) => string): string | null {
  switch (ev.type) {
    case "plan":
      return "Planning the search.";
    case "memory":
      return typeof ev.text === "string" && ev.text ? ev.text : "Using what it remembers about your chair.";
    case "tool": {
      const t = ev as ToolEvent;
      const sid = typeof t.args?.sid === "string" ? t.args.sid : null;
      const done = t.status === "done" || t.result != null;
      switch (t.name) {
        case "search_units": {
          const n = val((t.result as Record<string, unknown> | undefined)?.candidates);
          return done && n !== null ? `Found ${n} units near the medical center. Checking the best ones.` : "Searching units near the medical center.";
        }
        case "check_units":
          return "Driving your chair through the shortlisted floor plans.";
        case "run_fit":
          return sid
            ? `Driving your chair through ${unitName(sid)}${t.args?.hinges ? ", with offset hinges" : ""}.`
            : "Driving your chair through a floor plan.";
        case "aerial_check":
          return sid ? `Looking at the aerial image of ${unitName(sid)} for parking and curb ramps.` : "Looking at an aerial image.";
        case "draft_landlord_message":
          return "Drafting questions for the landlord.";
        default:
          return null;
      }
    }
    case "finding": {
      const f = ev as FindingEvent;
      return f.text ? `${f.sid ? `${unitName(f.sid)}: ` : ""}${f.text}` : null;
    }
    case "aerial":
      return (ev as FindingEvent).text || null;
    case "verify":
      return "Checking which figures are measured and which are estimated.";
    case "approval_needed":
      return "Waiting for your answer before anything is sent.";
    case "final":
      return null; // said after the loop, once it is known whether there is a shortlist
    default:
      return null;
  }
}

export function readSearch(run: Run, units: UnitRow[]): SearchView {
  const byId = new Map(units.map((u) => [u.sid, u]));
  const unitName = (sid: string) => byId.get(sid)?.name ?? "a unit";
  const status = new Map<string, PointStatus>();
  const fits = new Map<string, StatusCounts>();
  let narration = run.status === "running" ? "Starting the agent." : "";
  let shortlist: ShortItem[] = [];
  let fromAgent = false;
  let approval: ApprovalEvent | null = null;

  for (const ev of run.events) {
    const line = say(ev, unitName);
    if (line) narration = line;
    if (ev.type === "tool") {
      const t = ev as ToolEvent;
      for (const sid of [...sidsIn(t.args?.sids), ...sidsIn((t.result as Record<string, unknown> | undefined)?.sids)]) {
        if (!status.has(sid)) status.set(sid, "checking");
      }
      if (t.name === "run_fit" && !t.args?.hinges) {
        const sid = typeof t.args?.sid === "string" ? t.args.sid : null;
        const c = countsOf(t.result);
        if (sid && c) {
          fits.set(sid, c);
          status.set(sid, statusOfCounts(c));
        } else if (sid && !status.has(sid)) status.set(sid, "checking");
      }
    } else if (ev.type === "approval_needed") {
      approval = ev as ApprovalEvent;
    } else if (ev.type === "final") {
      const list = (ev as { shortlist?: unknown }).shortlist;
      if (Array.isArray(list)) {
        shortlist = list
          .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && typeof s.sid === "string")
          .slice(0, 3)
          .map((s) => {
            const sid = s.sid as string;
            const counts = countsOf(s) ?? fits.get(sid) ?? null;
            return {
              sid,
              name: typeof s.name === "string" ? s.name : unitName(sid),
              // the list's own summary is for the batch's chair, not this one: never borrowed
              reason: typeof s.summary === "string" ? s.summary : counts ? countsLine(counts) : "",
              counts,
            };
          });
        fromAgent = shortlist.length > 0;
      }
      const text = (ev as { text?: unknown }).text;
      narration = fromAgent
        ? approval
          ? "Done. The best fits are on the right, and a message waits for your answer."
          : "Done. The best fits are on the right."
        : typeof text === "string" && text
          ? text
          : "Done. The agent shortlisted no unit.";
    }
  }
  // a run that ends while units are still marked checking left them unchecked
  if (run.status !== "running") for (const [sid, st] of status) if (st === "checking") status.set(sid, "unchecked");

  if (!fromAgent && run.status !== "running" && fits.size) {
    // the agent sent no shortlist: show the units it checked, most rooms reached first
    shortlist = [...fits.entries()]
      .sort(([, a], [, b]) => share(b) - share(a) || a.blocked - b.blocked)
      .slice(0, 3)
      .map(([sid, c]) => ({ sid, name: unitName(sid), reason: countsLine(c), counts: c }));
    if (shortlist.length) narration = "The agent sent no shortlist. The units it checked are on the right.";
  }
  return { status, fits, narration, shortlist, fromAgent, approval, steps: run.events.length };
}

/** one line from the agent's own fit for this chair */
const countsLine = (c: StatusCounts) =>
  `${c.reachable} of ${c.reachable + c.blocked + c.unknown} rooms reached as scanned${c.blocked ? `, ${c.blocked} blocked` : ""}${c.unknown ? `, ${c.unknown} not measured` : ""} (estimated).`;

const share = (c: StatusCounts) => c.reachable / Math.max(1, c.reachable + c.blocked + c.unknown);
