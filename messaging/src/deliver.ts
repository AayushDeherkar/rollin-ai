/**
 * Delivery of approved messages to the leasing office, and its replies back (round 5).
 *
 * - The leasing office's number is configured (LEASING_OFFICE_NUMBER). The bridge texts it only
 *   after that number has texted the line first: Photon replies into a conversation, and a first
 *   text is the office's consent to be texted by an AI assistant.
 * - Every few seconds it reads GET /api/outbox (approved messages not yet delivered), sends each one
 *   queued since the bridge started, and marks it delivered (POST /api/outbox/{id}/delivered).
 *   Older items (from earlier runs) are never sent by surprise; they are listed in the log once.
 * - A text from the office is forwarded to POST /api/answers against the last message delivered.
 *
 * All calls go through the web app's routes, like the rest of the bridge.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  spaceId: string;
  agentId: string;
  /** when the office first texted (ISO 8601) */
  openedAt: string;
}

export interface DeliveryState {
  line: LeasingLine | null;
  /** the last message delivered, which a reply answers */
  lastDelivered: { id: string; sid: string | null } | null;
}

export interface OutboxApi {
  pending(): Promise<OutboxItem[]>;
  markDelivered(id: string): Promise<void>;
  answer(body: { outbox_id?: string; sid?: string; text: string; from: string }): Promise<{ rooms: { label: string }[]; unmatched: unknown[] }>;
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
      return json as { rooms: { label: string }[]; unmatched: unknown[] };
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
        return { line: s.line ?? null, lastDelivered: s.lastDelivered ?? null };
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
  private lastError = "";
  private busy = false;

  constructor(
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
  }

  get line(): LeasingLine | null {
    return this.state.line;
  }

  /**
   * A text from the leasing office. The first one opens the line. After a delivery, each one is
   * forwarded as the answer to the last message sent. Returns what happened, for the log.
   */
  async fromOffice(spaceId: string, agentId: string, text: string): Promise<string> {
    if (!this.state.line || this.state.line.spaceId !== spaceId) {
      this.state.line = { spaceId, agentId, openedAt: new Date().toISOString() };
      await this.store.save(this.state);
      if (!this.state.lastDelivered) return "The leasing office texted: approved messages can now be delivered to it.";
    }
    const last = this.state.lastDelivered;
    if (!last) return "The leasing office texted again; nothing has been delivered to it yet, so there is nothing to answer.";
    const got = await this.api.answer({ outbox_id: last.id, ...(last.sid ? { sid: last.sid } : {}), text, from: "leasing office" });
    return got.rooms.length
      ? `Leasing office answered about ${got.rooms.map((r) => r.label).join(", ")}.`
      : "Leasing office replied; it answered no room the scan left unknown (logged).";
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
        return;
      }
      this.waitingLogged = false;
      for (const item of fresh) {
        // a failing item is retried a few times, then left pending for a person to look at
        if ((this.failed.get(item.id) ?? 0) >= 3) continue;
        try {
          await this.send(line, item.text, `rollin:outbox:${item.id}`);
          this.state.lastDelivered = { id: item.id, sid: item.sid };
          await this.store.save(this.state);
          await this.api.markDelivered(item.id);
          this.log(`Delivered ${item.id} to the leasing office.`);
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
