/**
 * The bridge talks to the web app's API routes, not to the Python API directly: the web
 * routes already fall back to a recorded run and label it, so a text conversation and the
 * projector show the same thing and the same labels.
 */

export type Basis = "measured" | "estimated" | "assumed" | "asked" | "unknown";
export interface Num {
  value: number | null;
  unit?: string;
  basis: Basis;
}

export interface ShortlistUnit {
  sid: string;
  name?: string;
  summary?: string;
  distance_km?: number | Num | null;
}

export interface AgentEvent {
  id: string;
  type: string;
  replay?: boolean;
  [k: string]: unknown;
}

export interface AgentRun {
  events: AgentEvent[];
  /** true when the web app answered with a recorded or synthetic run, not the live agent */
  replay: boolean;
  /** why it is a replay, as the web app put it */
  reason: string | null;
}

export interface ApproveResult {
  action_id: string;
  approved: boolean;
  status: string;
  replay?: boolean;
}

export interface Rollin {
  run(message: string, profile: Record<string, unknown>): Promise<AgentRun>;
  units(): Promise<ShortlistUnit[]>;
  /** whether the web app can open this unit's plan (the API has its model cached) */
  hasPlan(sid: string): Promise<boolean>;
  approve(actionId: string, approved: boolean): Promise<ApproveResult>;
}

/** Split an SSE buffer into complete messages' data payloads, keeping the unfinished rest. */
export function takeMessages(buffer: string): { payloads: string[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  const payloads = parts
    .map((block) =>
      block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter(Boolean);
  return { payloads, rest };
}

export function webRollin(baseUrl: string, runTimeoutMs = 180_000): Rollin {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async run(message, profile) {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ message, profile }),
        signal: AbortSignal.timeout(runTimeoutMs),
      });
      if (!res.ok || !res.body) throw new Error(`The agent could not start (HTTP ${res.status}).`);
      let replay = res.headers.get("x-rollin-origin") !== "live";
      const reason = res.headers.get("x-rollin-replay-reason");
      const events: AgentEvent[] = [];
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        // at the end, a last event without its blank line still counts
        const { payloads, rest } = takeMessages(done ? `${buffer}\n\n` : buffer + value);
        buffer = rest;
        for (const p of payloads) {
          try {
            const ev = JSON.parse(p) as AgentEvent;
            if (ev.replay) replay = true;
            events.push(ev);
          } catch {
            /* skip a malformed event */
          }
        }
        if (done) break;
      }
      return { events, replay, reason };
    },
    async units() {
      const res = await fetch(`${base}/api/units`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const body = (await res.json()) as { units?: ShortlistUnit[] };
      return body.units ?? [];
    },
    async hasPlan(sid) {
      try {
        const res = await fetch(`${base}/api/units/${encodeURIComponent(sid)}`, { signal: AbortSignal.timeout(10_000) });
        await res.body?.cancel();
        return res.ok;
      } catch {
        return false;
      }
    },
    async approve(actionId, approved) {
      const res = await fetch(`${base}/api/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action_id: actionId, approved }),
        signal: AbortSignal.timeout(40_000),
      });
      const body = (await res.json().catch(() => null)) as (ApproveResult & { detail?: string }) | null;
      if (res.status === 409) return { action_id: actionId, approved, status: "already decided" };
      if (!res.ok || !body) throw new Error(body?.detail ?? `HTTP ${res.status}`);
      return body;
    },
  };
}
