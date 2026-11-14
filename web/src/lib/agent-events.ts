/**
 * Agent events from POST /api/chat (contracts/chat_events.example.jsonl).
 * Every number is wrapped with its basis: how we know it.
 */
import type { RoomStatus } from "./contract";

export type Basis = "measured" | "estimated" | "assumed" | "asked" | "unknown";

export interface Num {
  value: number | null;
  unit?: string;
  basis: Basis;
  /** for "asked": who told us (user, landlord) */
  source?: string;
  note?: string;
}

export function isNum(x: unknown): x is Num {
  return typeof x === "object" && x !== null && "basis" in x && "value" in x;
}

interface Base {
  id: string;
  ts: string;
  run_id: string;
  /** set on every event of a recorded run played back */
  replay?: boolean;
}

export interface Todo {
  id: string;
  text: string;
  status: string;
}

export interface PlanEvent extends Base {
  type: "plan";
  text: string;
  todos?: Todo[];
  /** the profile the run uses (contract v3): who is asking and the chair, each number with its basis */
  profile?: { sender_id?: string; chair_in?: Num[] | null };
}
export interface ToolEvent extends Base {
  type: "tool";
  name: string;
  status?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}
export interface FindingEvent extends Base {
  type: "finding" | "aerial";
  sid?: string;
  room_id?: string;
  room?: string;
  status?: RoomStatus;
  text: string;
  numbers?: Record<string, Num>;
  evidence?: { kind: string; edge?: string; center?: Num[] } | null;
  /** the fit the finding came from: "as scanned" or "offset hinges on every door" */
  scenario?: string;
  /** aerial: GET /api/aerial/{sid}, its label ("from aerial, estimated"), who made the image */
  image_url?: string;
  label?: string;
  source?: string;
  /** what a model saw in an image; every answer carries its basis and label */
  findings?: VisionFinding[];
}

export interface VisionFinding {
  item: string;
  question: string;
  answer: "yes" | "no" | "unclear" | string;
  note?: string;
  basis: Basis;
  label?: string;
}
export interface VerifyEvent extends Base {
  type: "verify";
  checked: { claim: string; basis: Basis; note?: string }[];
  questions?: string[];
}
export interface ApprovalEvent extends Base {
  type: "approval_needed";
  action_id: string;
  action: string;
  to?: { label: string };
  draft?: string;
  reason?: string;
}
export interface FinalEvent extends Base {
  type: "final";
  text?: string;
  awaiting_approval?: string[];
}
export interface OtherEvent extends Base {
  type: string;
  text?: string;
}

export type AgentEvent = PlanEvent | ToolEvent | FindingEvent | VerifyEvent | ApprovalEvent | FinalEvent | OtherEvent;

/** POST /api/approve result (agent/approvals.py) */
export interface ApproveResult {
  action_id: string;
  approved: boolean;
  status: string;
  replay?: boolean;
}
