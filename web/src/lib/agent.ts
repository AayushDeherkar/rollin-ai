"use client";

/**
 * One agent run: POST /api/chat, read the SSE stream event by event, and send approval
 * decisions to /api/approve. `acting` is true only while the agent is doing something
 * (streaming, or carrying out an approved action): the one time the accent colour shows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ORIGIN_HEADER, REPLAY_REASON_HEADER, type Origin } from "./contract";
import type { AgentEvent, ApproveResult } from "./agent-events";

export type RunStatus = "idle" | "running" | "done" | "stopped" | "error";

export interface Run {
  status: RunStatus;
  events: AgentEvent[];
  origin: Origin | null;
  reason: string | null;
  error: string | null;
}

export type Decision =
  | { state: "sending"; approved: boolean }
  | { state: "done"; result: ApproveResult }
  | { state: "error"; approved: boolean; message: string };

const IDLE: Run = { status: "idle", events: [], origin: null, reason: null, error: null };

/** Split an SSE buffer into complete messages; returns the JSON payloads and the unparsed rest. */
function takeMessages(buffer: string): { payloads: string[]; rest: string } {
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

export function useAgentRun() {
  const [run, setRun] = useState<Run>(IDLE);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setRun((r) => (r.status === "running" ? { ...r, status: "stopped" } : r));
  }, []);

  const start = useCallback(async (message: string, profile: Record<string, unknown>, opts: { replay?: boolean } = {}) => {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    setRun({ ...IDLE, status: "running" });
    setDecisions({});
    try {
      const res = await fetch(`/api/chat${opts.replay ? "?replay=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, profile }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`The agent could not start (HTTP ${res.status}).`);
      const origin: Origin = res.headers.get(ORIGIN_HEADER) === "live" ? "live" : "replay";
      setRun((r) => ({ ...r, origin, reason: res.headers.get(REPLAY_REASON_HEADER) }));

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const { payloads, rest } = takeMessages(buffer);
        buffer = rest;
        const events: AgentEvent[] = [];
        for (const p of payloads) {
          try {
            events.push(JSON.parse(p) as AgentEvent);
          } catch {
            /* skip a malformed event rather than stop the run */
          }
        }
        if (events.length) {
          // a recorded run says so on every event, even if it came through the live route
          const replayed = events.some((e) => e.replay);
          setRun((r) => ({ ...r, events: [...r.events, ...events], origin: replayed ? "replay" : r.origin }));
        }
      }
      if (!ac.signal.aborted) setRun((r) => ({ ...r, status: "done" }));
    } catch (err) {
      if (ac.signal.aborted) return;
      setRun((r) => ({ ...r, status: "error", error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  const decide = useCallback(async (actionId: string, approved: boolean) => {
    setDecisions((d) => ({ ...d, [actionId]: { state: "sending", approved } }));
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action_id: actionId, approved }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body && typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
      setDecisions((d) => ({ ...d, [actionId]: { state: "done", result: body as ApproveResult } }));
    } catch (err) {
      setDecisions((d) => ({ ...d, [actionId]: { state: "error", approved, message: err instanceof Error ? err.message : String(err) } }));
    }
  }, []);

  const acting = run.status === "running" || Object.values(decisions).some((d) => d.state === "sending");
  return { run, decisions, acting, start, stop, decide };
}
