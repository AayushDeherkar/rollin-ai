/**
 * Photon 2.0 (beta) transport: inbound iMessages over Photon's Socket.IO event stream
 * (no public URL needed on the demo laptop), replies through the messaging API.
 * Docs: https://photon.codes/docs/beta/message-delivery/websocket and
 *       https://photon.codes/docs/beta/get-started/imessage
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Photon } from "@photon-ai/api";
import { io } from "socket.io-client";

export interface PhotonConfig {
  apiKey: string;
  projectId: string;
  /** only these senders (E.164 numbers or iMessage emails) are answered; empty = everyone */
  allowedSenders: string[];
  /** where the stream cursor is kept between restarts (gitignored) */
  stateDir: string;
}

/** An inbound text, reduced to what a reply needs. */
export interface Inbound {
  messageId: string;
  spaceId: string;
  /** the agent's own user id in this space: the reply's sender */
  agentId: string;
  from: string;
  text: string;
  /** when Photon received it (ISO 8601) */
  createdAt: string;
}

/** Older texts are not acted on, e.g. a "yes" redelivered after a restart. */
export const MAX_AGE_MS = 10 * 60_000;

/** Narrow a `message.received` event to a plain-text iMessage from a person; anything else is null. */
export function inboundFrom(event: unknown): Inbound | null {
  const e = event as { type?: string; data?: { object?: Record<string, any> } };
  if (e?.type !== "message.received") return null;
  const m = e.data?.object;
  if (!m || m.platform !== "imessage" || m.status !== "received") return null;
  if (m.sentBy?.kind !== "human" || m.receivedBy?.kind !== "agent") return null;
  if (m.content?.type !== "text" || typeof m.content.text !== "string") return null;
  if (typeof m.id !== "string" || typeof m.space?.id !== "string" || typeof m.receivedBy?.id !== "string") return null;
  return {
    messageId: m.id,
    spaceId: m.space.id,
    agentId: m.receivedBy.id,
    from: String(m.sentBy.handle ?? ""),
    text: m.content.text,
    createdAt: String(m.createdAt ?? ""),
  };
}

export function photonClient(cfg: PhotonConfig) {
  const photon = new Photon({ headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  const cursorFile = path.join(cfg.stateDir, "photon-cursor.json");
  /** Send the `n`th plain-text reply to `to`, into the conversation it came from. */
  async function reply(to: Inbound, text: string, n: number): Promise<void> {
    await photon.projects.sendMessage({
      path: { id: cfg.projectId },
      // stable per inbound message and reply number, so a retry never double-sends
      headers: { "idempotency-key": `rollin:${to.messageId}:${n}` },
      body: { spaceId: to.spaceId, senderId: to.agentId, parentMessageId: to.messageId, content: { type: "text", format: "plain", text } },
    });
  }

  async function loadCursor(): Promise<number> {
    try {
      const { seq } = JSON.parse(await readFile(cursorFile, "utf8")) as { seq?: unknown };
      return typeof seq === "number" ? seq : 0;
    } catch {
      return 0;
    }
  }
  async function saveCursor(seq: number): Promise<void> {
    await mkdir(cfg.stateDir, { recursive: true });
    await writeFile(cursorFile, JSON.stringify({ seq }));
  }

  /**
   * Subscribe to the project's events and call `onText` for each allowed inbound text, one at a
   * time. The cursor is saved only after a message is handled. If handling fails, the stream
   * stops (Photon's guidance) and `onStop` is called; a restart resumes from the saved cursor.
   * startSeq 0 means new events only; to resume, Photon takes the last processed cursor itself.
   */
  async function listen(onText: (m: Inbound) => Promise<void>, log: (s: string) => void, onStop: () => void): Promise<void> {
    let cursor = await loadCursor();
    const seen = new Set<string>();
    let queue = Promise.resolve();
    let stopped = false;
    const socket = io("https://api.photon.codes", {
      path: `/v1/projects/${cfg.projectId}/events/ws`,
      addTrailingSlash: false,
      transports: ["websocket"],
      extraHeaders: { Authorization: `Bearer ${cfg.apiKey}` },
      autoConnect: false,
    });
    socket.on("connect", () => {
      socket.emit("subscribe", { startSeq: cursor }, (ack: { ok?: boolean; error?: unknown }) => {
        if (ack?.ok) log(`Listening for iMessages (from cursor ${cursor}).`);
        else log(`Photon refused the subscription: ${JSON.stringify(ack?.error ?? ack)}`);
      });
    });
    socket.on("connect_error", (err: Error) => log(`Photon connection failed: ${err.message}`));
    socket.on("delivery_error", (err: unknown) => log(`Photon delivery error: ${JSON.stringify(err)}`));
    socket.on("delivery", (event: unknown, meta: { seq: number }) => {
      queue = queue.then(async () => {
        if (stopped) return;
        const m = inboundFrom(event);
        const allowed = m && (cfg.allowedSenders.length === 0 || cfg.allowedSenders.includes(m.from));
        const age = m ? Date.now() - Date.parse(m.createdAt) : 0;
        if (m && !allowed) log("Ignored a message from a sender not in PHOTON_ALLOWED_SENDERS.");
        else if (m && !(age <= MAX_AGE_MS)) log(`Ignored message ${m.messageId}: older than ${MAX_AGE_MS / 60_000} minutes.`);
        else if (m && !seen.has(m.messageId)) {
          seen.add(m.messageId);
          try {
            await onText(m);
          } catch (err) {
            stopped = true;
            socket.disconnect();
            log(`Stopped: could not handle message ${m.messageId} (${err instanceof Error ? err.message : String(err)}). Restart to retry from cursor ${cursor}.`);
            onStop();
            return;
          }
        }
        cursor = meta.seq;
        await saveCursor(cursor);
      });
    });
    socket.connect();
  }

  return { reply, listen };
}
