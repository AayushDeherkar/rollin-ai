/**
 * One text conversation with the agent, independent of the messaging service:
 *   first message → the agent says it is an AI;
 *   a request    → run the agent, reply with the top three units and a link to the plans,
 *                  then ask before contacting anyone;
 *   "yes" / "no" → /api/approve, and say plainly what happened.
 * Nothing is ever sent to a third party without a "yes" from the person in this conversation.
 */
import type { AgentEvent, AgentRun, Num, Rollin, ShortlistUnit } from "./rollin.ts";

export const INTRO =
  "Hi, I'm Rollin', an AI agent, not a person. I check whether apartments fit a specific wheelchair, " +
  "using measured floor plans. Room counts are estimates from those plans, and I can be wrong.";

const YES = /^(yes|y|yeah|yep|sure|ok|okay|send|send it|go ahead)$/i;
const NO = /^(no|n|nope|don'?t|do not|don'?t send|cancel|stop)$/i;

export function yesNo(text: string): boolean | null {
  const t = text.trim().replace(/[.!\s]+$/, "").toLowerCase();
  if (YES.test(t)) return true;
  if (NO.test(t)) return false;
  return null;
}

/** "27 x 42", "27×42 in", "27 by 42" → [27, 42]. Only a width and a length together count. */
export function chairFrom(text: string): [number, number] | null {
  const m = text.match(/(\d{2}(?:\.\d+)?)\s*(?:in(?:ches)?|"|”)?\s*(?:x|×|by)\s*(\d{2}(?:\.\d+)?)/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : v && typeof v === "object" && "value" in v ? ((v as Num).value ?? null) : null;

function shortlistOf(run: AgentRun): ShortlistUnit[] | null {
  const final = run.events.find((e) => e.type === "final");
  const list = final?.shortlist;
  if (!Array.isArray(list) || list.length === 0) return null;
  return [...(list as (ShortlistUnit & { rank?: unknown })[])].sort((a, b) => (num(a.rank) ?? 1e9) - (num(b.rank) ?? 1e9));
}

export function resultsText(
  run: AgentRun,
  units: ShortlistUnit[],
  chair: [number, number] | null,
  webUrl: string,
  fromThisSearch = true,
): string {
  const lines: string[] = [];
  if (run.replay) lines.push("This is a replayed run, not a live search.");
  const final = run.events.find((e) => e.type === "final");
  if (typeof final?.text === "string" && final.text) lines.push(final.text);
  const top = units.slice(0, 3);
  if (top.length === 0) {
    lines.push("I have no units to show yet.");
    return lines.join("\n\n");
  }
  const who = chair ? `a ${chair[0]} × ${chair[1]} in chair` : "your chair";
  const rows = top.map((u, i) => {
    const km = num(u.distance_km);
    const where = km === null ? "" : ` (${km.toFixed(1)} km)`;
    return `${i + 1}. ${u.name ?? u.sid}${where}: ${u.summary ?? "no summary"}`;
  });
  const title = fromThisSearch
    ? `Top ${top.length} for ${who}, estimated from the floor plans:`
    : `The search returned no shortlist. Top ${top.length} of the latest ranked list (not specific to your message), estimated from the floor plans:`;
  lines.push(`${title}\n${rows.join("\n")}`);
  lines.push(`See the plans: ${webUrl.replace(/\/+$/, "")}/?sid=${encodeURIComponent(top[0].sid)}`);
  return lines.join("\n\n");
}

export function approvalText(run: AgentRun): { actionId: string; text: string } | null {
  const ask = run.events.find((e) => e.type === "approval_needed") as
    | (AgentEvent & { action_id?: string; to?: { label?: string }; draft?: string })
    | undefined;
  if (!ask?.action_id) return null;
  const verify = run.events.find((e) => e.type === "verify");
  const n = Array.isArray(verify?.questions) ? verify.questions.length : 0;
  const who = ask.to?.label ?? "the leasing office";
  const what = n > 0 ? `the ${n} things I couldn't verify` : "what I couldn't verify";
  const draft = ask.draft ? `\n\nI would send:\n"${ask.draft}"` : "";
  return { actionId: ask.action_id, text: `Want me to message ${who} about ${what}?${draft}\n\nReply yes or no.` };
}

interface State {
  introduced: boolean;
  pending: string | null;
  /** serialises messages within one conversation */
  chain: Promise<void>;
}

export type Say = (text: string) => Promise<void>;

export class Conversations {
  private readonly states = new Map<string, State>();
  constructor(
    private readonly rollin: Rollin,
    private readonly webUrl: string,
  ) {}

  /**
   * Handle one inbound text; replies go out through `say`, in order. Rejects if the text could
   * not be handled (after trying to say so), so a transport knows not to mark it done.
   */
  handle(key: string, text: string, say: Say): Promise<void> {
    const s = this.states.get(key) ?? { introduced: false, pending: null, chain: Promise.resolve() };
    this.states.set(key, s);
    const next = s.chain.then(async () => {
      try {
        await this.step(s, text, say);
      } catch (err) {
        // never leave a question open that the person may not have seen
        s.pending = null;
        await say(`Something went wrong on my side: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
        throw err;
      }
    });
    s.chain = next.catch(() => {});
    return next;
  }

  private async step(s: State, text: string, say: Say): Promise<void> {
    if (!s.introduced) {
      s.introduced = true;
      await say(INTRO);
    }
    const answer = s.pending ? yesNo(text) : null;
    if (s.pending && answer !== null) {
      const actionId = s.pending;
      s.pending = null;
      const r = await this.rollin.approve(actionId, answer);
      if (r.status === "already decided") return say("That was already decided.");
      if (r.replay) return say("Not sent: this was a replayed run, so nothing went out.");
      if (!r.approved) return say("OK, I won't contact them.");
      return say(`Approved. Status: ${r.status}.`);
    }
    // anything else is a new request; an unanswered question lapses
    s.pending = null;
    await say("Checking units now. This takes about a minute.");
    const chair = chairFrom(text);
    const run = await this.rollin.run(text, chair ? { chair_in: chair } : {});
    const shortlist = shortlistOf(run);
    const units = shortlist ?? (await this.rollin.units());
    await say(resultsText(run, units, chair, this.webUrl, shortlist !== null));
    const ask = approvalText(run);
    if (ask) {
      await say(ask.text);
      // open only once the question has gone out
      s.pending = ask.actionId;
    }
  }
}
