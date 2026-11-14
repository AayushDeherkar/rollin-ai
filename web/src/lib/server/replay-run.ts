/**
 * Local fallback for POST /api/chat when the API cannot answer at all: plays the synthetic
 * contract run (contracts/chat_events.example.jsonl) as SSE, the way agent/chat.py replays it.
 * Every event is marked `replay: true`; approvals for it are never sent.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const DELAY_S: Record<string, number> = { plan: 0.8, tool: 1.6, finding: 0.9, verify: 1.2, aerial: 1.4, approval_needed: 0.8, final: 0.7 };
export const LOCAL_REPLAY_TAG = "_webreplay";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const onAbort = () => (clearTimeout(t), resolve());
    const t = setTimeout(() => (signal.removeEventListener("abort", onAbort), resolve()), ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

/**
 * The synthetic contract run. next dev and next start run from web/ with the contracts beside it;
 * a deployed function may run from the repo root instead (next.config traces the file in).
 */
async function readContractRun(): Promise<string> {
  const name = path.join("contracts", "chat_events.example.jsonl");
  const tried = [path.join(process.cwd(), "..", name), path.join(process.cwd(), name)];
  for (const file of tried) {
    try {
      return await readFile(file, "utf8");
    } catch {
      /* try the next place */
    }
  }
  throw new Error("the synthetic contract run (contracts/chat_events.example.jsonl) is not in this build");
}

export async function localReplayStream(pace: number, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  type Ev = Record<string, unknown> & { type: string; id: string; ts?: string };
  const events: Ev[] = [];
  for (const line of (await readContractRun()).split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as Ev);
    } catch {
      /* skip a malformed line rather than break the stream */
    }
  }
  const runId = `${LOCAL_REPLAY_TAG.slice(1)}_${Math.random().toString(16).slice(2, 10)}`;
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(enc.encode(": rollin event stream (local replay)\n\n"));
      for (const ev of events) {
        if (signal.aborted) break;
        if (pace > 0) await sleep((DELAY_S[ev.type] ?? 1) * pace * 1000, signal);
        if (signal.aborted) break;
        const out: Record<string, unknown> = { ...ev, recorded_ts: ev.ts, ts: new Date().toISOString(), run_id: runId, replay: true };
        if (ev.type === "approval_needed") out.action_id = `${ev.action_id}${LOCAL_REPLAY_TAG}`;
        if (ev.type === "final" && Array.isArray(ev.awaiting_approval)) {
          out.awaiting_approval = (ev.awaiting_approval as string[]).map((a) => `${a}${LOCAL_REPLAY_TAG}`);
        }
        controller.enqueue(enc.encode(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(out)}\n\n`));
      }
      controller.close();
    },
  });
}
