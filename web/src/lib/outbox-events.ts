"use client";

/**
 * GET /api/events: what happens after a run has ended. `delivered` when the iMessage bridge has
 * texted an approved message to the leasing office; `answer` when the office's reply came back
 * and was logged (contracts/README.md, "Delivery and leasing-office answers"). The stream stays
 * open; the browser resends Last-Event-ID itself, and a refused stream (no API) is retried.
 */
import { useEffect, useState } from "react";

export interface DeliveredEvent {
  id: string;
  type: "delivered";
  outbox_id: string;
  sid: string | null;
  to: string;
  via: string | null;
  delivered_at: string;
  /** a status line ("Delivered to … via …"), not the message */
  text: string;
}

export interface AnswerEvent {
  id: string;
  type: "answer";
  answer_id: string;
  sid: string;
  outbox_id: string | null;
  rooms: { room_id: string; label: string; basis: "asked"; source: "landlord"; clear_in: AskedWidth }[];
  unmatched: unknown[];
  text: string;
}

/** a width the leasing office gave: inches, basis "asked"; null when the reply gave none */
export interface AskedWidth {
  value: number | null;
  unit?: string;
  basis: string;
  source?: string;
}

const RETRY_MS = 5000;

export function useOutboxEvents(enabled = true): { delivered: DeliveredEvent[]; answers: AnswerEvent[] } {
  const [delivered, setDelivered] = useState<DeliveredEvent[]>([]);
  const [answers, setAnswers] = useState<AnswerEvent[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let timer: number | undefined;
    let closed = false;
    const parse = <T,>(e: MessageEvent): T | null => {
      try {
        return JSON.parse(e.data) as T;
      } catch {
        return null;
      }
    };
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("delivered", (e) => {
        const ev = parse<DeliveredEvent>(e as MessageEvent);
        if (ev) setDelivered((d) => (d.some((x) => x.id === ev.id) ? d : [...d, ev]));
      });
      es.addEventListener("answer", (e) => {
        const ev = parse<AnswerEvent>(e as MessageEvent);
        if (ev) setAnswers((a) => (a.some((x) => x.id === ev.id) ? a : [...a, ev]));
      });
      es.onerror = () => {
        // a refused stream (503: no API) is not retried by the browser; try again later
        if (es?.readyState === EventSource.CLOSED && !closed) timer = window.setTimeout(connect, RETRY_MS);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      es?.close();
    };
  }, [enabled]);
  return { delivered, answers };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The delivery of an approved message, matched by its recipient (the approval's `to.label` is what
 * send_message queues as `to`), and delivered after the approval was given. The approve result
 * carries no outbox id yet, so this is the closest match the contract allows.
 */
export function deliveryOf(to: string | undefined, decidedAt: number | null, delivered: DeliveredEvent[]): DeliveredEvent | null {
  if (!to || decidedAt === null) return null;
  const want = squash(to);
  return delivered.find((e) => squash(e.to) === want && Date.parse(e.delivered_at) >= decidedAt - 5000) ?? null;
}
