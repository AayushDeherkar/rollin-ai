/**
 * Delivery of approved messages to the leasing office, and its replies back (round 5).
 *
 * - The leasing office's number is configured (LEASING_OFFICE_NUMBER). The bridge texts it only
 *   after that number has texted the line first: Photon replies into a conversation, and a first
 *   text is the office's consent to be texted by an AI assistant.
 * - Every few seconds it reads GET /api/outbox (approved messages not yet delivered), sends each one
 *   queued since the bridge started, and marks it delivered (POST /api/outbox/{id}/delivered).
 *   Older items (from earlier runs) are never sent by surprise; they are listed in the log once.
 * - A text from the office is never a renter’s request. Its first text gets a one-line acknowledgement;
 *   each later one is forwarded to POST /api/answers against the last message delivered, and the
 *   findings are texted back to the client conversation that was active when that message was
 *   delivered (a separate conversation: nothing the office says is ever taken as an approval).
 * - If the office already has a conversation on the project (it texted earlier), it is found at start
 *   and used, so it does not have to text again.
 *
 * All calls go through the web app's routes, like the rest of the bridge.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** the one line the office gets back for its first text: who is texting, and that it is an AI */
export const OFFICE_ACK =
  "Hi, this is Rollin’, an AI assistant helping a renter who uses a wheelchair. Thanks: their approved questions about your units will come to this number.";

/** texted to the client when its approved questions go out, and once while they wait for the office */
export const SENT_TO_CLIENT = "Rollin’ (AI assistant): I sent your approved questions to the leasing office. I’ll text you what they say.";
export const WAITING_TO_CLIENT =
  "Rollin’ (AI assistant): your approved questions are queued. The leasing office has not texted this line yet, so I can’t send them until it does.";

export interface OutboxItem {
  id: string;
  to: string;
  text: string;
  sid: string | null;
  queued_at: string;
  status: string;
}

/** The conversation with the leasing office, learnt from its first text. */
export interface LeasingLine {
  /** who opened it: a saved line is used only while this is still the configured office */
  handle: string;
  spaceId: string;
  agentId: string;
  /** when the office first texted (ISO 8601) */
  openedAt: string;
}

/** A client’s conversation (a PHOTON_ALLOWED_SENDERS number), where the office’s findings are sent. */
export interface ClientLine {
  handle: string;
  spaceId: string;
  agentId: string;
}

export interface DeliveryState {
  line: LeasingLine | null;
  /** the last message delivered, which a reply answers, and the client conversation active when it went */
  lastDelivered: { id: string; sid: string | null; client?: ClientLine | null } | null;
  /** the client conversation that texted last */
  client?: ClientLine | null;
}

export type Role = "client" | "office";

/**
 * Who a sender is. The leasing office is its own role and never a client, even with no sender
 * restriction; anyone else is a client only when listed (or when no list is set). Returns null to ignore.
 */
export function roleOf(clients: string[], office: string): (from: string) => Role | null {
  if (office && clients.some((c) => sameHandle(c, office))) {
    throw new Error("LEASING_OFFICE_NUMBER is also in PHOTON_ALLOWED_SENDERS: one number cannot be both the client and the leasing office.");
  }
  return (from) => {
    if (!from) return null;
    if (office && sameHandle(from, office)) return "office";
    return clients.length === 0 || clients.some((c) => sameHandle(c, from)) ? "client" : null;
  };
}

type AnsweredRoom = { label: string; clear_in?: number | null };

/** The text the client gets after the office replies: the reply itself, and what was logged from it. */
export function findingsText(reply: string, got: { rooms: AnsweredRoom[] } | null): string {
  const quoted = reply.length > 600 ? `${reply.slice(0, 600)}…` : reply;
  const lines = [`Rollin’ (AI assistant) here. The leasing office replied to the questions you approved:`, `“${quoted}”`];
  if (!got) lines.push("I could not log it against the scan, so the floor plan is unchanged.");
  else if (!got.rooms.length) lines.push("It did not answer any door the scan left unknown, so the floor plan is unchanged.");
  else {
    const rooms = got.rooms.map((r) => (typeof r.clear_in === "number" ? `${r.label}: ${r.clear_in} in clear` : `${r.label}: answered, no width given`));
    lines.push(`Logged on the plan: ${rooms.join("; ")}. As told by the leasing office, not measured.`);
  }
  return lines.join("\n");
}


export interface OutboxApi {
  pending(): Promise<OutboxItem[]>;
  markDelivered(id: string): Promise<void>;
  answer(body: { outbox_id?: string; sid?: string; text: string; from: string }): Promise<{ rooms: AnsweredRoom[]; unmatched: unknown[] }>;
}

export function webOutbox(baseUrl: string): OutboxApi {
  const base = baseUrl.replace(/\/+$/, "");
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { res, json };
  };
  return {
    async pending() {
      const res = await fetch(`${base}/api/outbox`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`outbox not available (HTTP ${res.status})`);
      const body = (await res.json()) as { items?: OutboxItem[] };
      return (body.items ?? []).filter((i) => i.status === "pending");
    },
    async markDelivered(id) {
      const { res, json } = await post(`${base}/api/outbox/${encodeURIComponent(id)}/delivered`, { via: "imessage" });
      // 409: already marked (a retry after a crash between sending and marking)
      if (!res.ok && res.status !== 409) throw new Error(String(json?.detail ?? `HTTP ${res.status}`));
    },
    async answer(body) {
      const { res, json } = await post(`${base}/api/answers`, body);
      if (!res.ok || !json) throw new Error(String(json?.detail ?? `HTTP ${res.status}`));
      return json as { rooms: AnsweredRoom[]; unmatched: unknown[] };
    },
  };
}

/** E.164 and iMessage handles compared loosely: digits only for numbers (a leading 1 dropped), case-blind for emails. */
export function sameHandle(a: string, b: string): boolean {
  if (a.includes("@") || b.includes("@")) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const da = digits(a);
  return da.length >= 7 && da === digits(b);
}

export function fileState(stateDir: string) {
  const file = path.join(stateDir, "leasing.json");
  return {
    async load(): Promise<DeliveryState> {
      try {
        const s = JSON.parse(await readFile(file, "utf8")) as Partial<DeliveryState>;
        return { line: s.line ?? null, lastDelivered: s.lastDelivered ?? null, client: s.client ?? null };
      } catch {
        return { line: null, lastDelivered: null };
      }
    },
    async save(s: DeliveryState) {
      await mkdir(stateDir, { recursive: true });
      await writeFile(file, JSON.stringify(s, null, 1));
    },
  };
}

export class Deliverer {
  private state: DeliveryState = { line: null, lastDelivered: null };
  private skipped = new Set<string>();
  private failed = new Map<string, number>();
  private waitingLogged = false;
  private waitingTold = false;
  private lastError = "";
  private busy = false;
  /** send the office’s findings into a client’s conversation; unset, they are only logged */
  notifyClient: ((client: ClientLine, text: string, key: string) => Promise<void>) | null = null;

  constructor(
    /** the configured leasing office (LEASING_OFFICE_NUMBER) */
    private office: string,
    private api: OutboxApi,
    /** send a text into the leasing office's conversation; the key makes a retry a no-op */
    private send: (line: LeasingLine, text: string, key: string) => Promise<void>,
    private store: { load(): Promise<DeliveryState>; save(s: DeliveryState): Promise<void> },
    private log: (s: string) => void,
    /** only messages queued at or after this time are sent */
    private since: Date = new Date(),
  ) {}

  async start(): Promise<void> {
    this.state = await this.store.load();
    const line = this.state.line;
    if (line && !(typeof line.handle === "string" && sameHandle(line.handle, this.office))) {
      // opened by another number (the setting changed): that number is not the office any more
      this.state = { line: null, lastDelivered: null };
      await this.store.save(this.state);
    }
  }

  get line(): LeasingLine | null {
    return this.state.line;
  }

  /** The office’s existing conversation, found on the project at start: used when none is saved yet. */
  async adopt(line: LeasingLine): Promise<boolean> {
    if (this.state.line || !sameHandle(line.handle, this.office)) return false;
    this.state.line = line;
    await this.store.save(this.state);
    return true;
  }

  /** A client texted: findings for messages delivered from now on go back to this conversation. */
  async noteClient(client: ClientLine): Promise<void> {
    if (this.office && sameHandle(client.handle, this.office)) return;
    const c = this.state.client;
    if (c && c.spaceId === client.spaceId && c.agentId === client.agentId && c.handle === client.handle) return;
    this.state.client = client;
    await this.store.save(this.state);
  }

  /**
   * A text from the leasing office. It is never a renter’s request. The very first one opens the line
   * and gets a one-line acknowledgement (returned as `reply`; the caller sends it). Every later one is
   * forwarded to /api/answers as the answer to the last message delivered. `log` says what happened.
   */
  async fromOffice(handle: string, spaceId: string, agentId: string, text: string, messageId = ""): Promise<{ log: string; reply: string | null }> {
    if (!sameHandle(handle, this.office)) return { log: "Ignored: not the configured leasing office.", reply: null };
    if (!this.state.line) {
      this.state.line = { handle, spaceId, agentId, openedAt: new Date().toISOString() };
      await this.store.save(this.state);
      return { log: "The leasing office texted first: line open, acknowledged; approved messages can now be delivered to it.", reply: OFFICE_ACK };
    }
    if (this.state.line.spaceId !== spaceId) {
      // the same office in a new conversation: deliver there from now on
      this.state.line = { ...this.state.line, spaceId, agentId };
      await this.store.save(this.state);
    }
    const last = this.state.lastDelivered;
    if (!last) return { log: "The leasing office texted again; nothing has been delivered to it yet, so there is nothing to answer.", reply: null };
    let got: { rooms: AnsweredRoom[] } | null = null;
    let failed = "";
    try {
      got = await this.api.answer({ outbox_id: last.id, ...(last.sid ? { sid: last.sid } : {}), text, from: "leasing office" });
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
    }
    const said = failed
      ? `Leasing office replied; logging it failed (${failed}).`
      : got!.rooms.length
        ? `Leasing office answered about ${got!.rooms.map((r) => r.label).join(", ")}.`
        : "Leasing office replied; it answered no room the scan left unknown (logged).";
    // the findings go to the client whose conversation was active when the question went out
    const client = last.client ?? this.state.client ?? null;
    if (!client || !this.notifyClient) return { log: `${said} No client conversation to text the findings to.`, reply: null };
    try {
      await this.notifyClient(client, findingsText(text, got), `rollin:findings:${messageId || `${last.id}:${text.length}`}`);
      return { log: `${said} Findings texted to the client.`, reply: null };
    } catch (err) {
      return { log: `${said} Texting the findings to the client failed: ${err instanceof Error ? err.message : String(err)}`, reply: null };
    }
  }

  /** A status line to the client conversation, if one is known. Never throws. */
  private async tellClient(text: string, key: string): Promise<void> {
    const client = this.state.client;
    if (!client || !this.notifyClient) return;
    try {
      await this.notifyClient(client, text, key);
    } catch (err) {
      this.log(`Could not text the client: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One pass over the outbox. Never throws. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const items = await this.api.pending();
      const fresh = items.filter((i) => Date.parse(i.queued_at) >= this.since.getTime());
      for (const i of items) {
        if (fresh.includes(i) || this.skipped.has(i.id)) continue;
        this.skipped.add(i.id);
        this.log(`Not sending ${i.id}: it was queued before this bridge started.`);
      }
      if (!fresh.length) return;
      const line = this.state.line;
      if (!line) {
        if (!this.waitingLogged) this.log(`${fresh.length} approved message(s) waiting: the leasing office has to text this line first.`);
        this.waitingLogged = true;
        // once, as soon as a client conversation is known (it may text after the first tick)
        if (!this.waitingTold && this.state.client) {
          this.waitingTold = true;
          await this.tellClient(WAITING_TO_CLIENT, `rollin:waiting:${fresh[0].id}`);
        }
        return;
      }
      this.waitingLogged = false;
      this.waitingTold = false;
      for (const item of fresh) {
        // a failing item is retried a few times, then left pending for a person to look at
        if ((this.failed.get(item.id) ?? 0) >= 3) continue;
        try {
          await this.send(line, item.text, `rollin:outbox:${item.id}`);
          this.state.lastDelivered = { id: item.id, sid: item.sid, client: this.state.client ?? null };
          await this.store.save(this.state);
          await this.api.markDelivered(item.id);
          this.log(`Delivered ${item.id} to the leasing office.`);
          await this.tellClient(SENT_TO_CLIENT, `rollin:sent:${item.id}`);
        } catch (err) {
          this.failed.set(item.id, (this.failed.get(item.id) ?? 0) + 1);
          this.log(`Could not deliver ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.lastError = "";
    } catch (err) {
      // said once until it changes, not every few seconds
      const msg = `Outbox check failed: ${err instanceof Error ? err.message : String(err)}`;
      if (msg !== this.lastError) this.log(msg);
      this.lastError = msg;
    } finally {
      this.busy = false;
    }
  }
}
