import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACK, Conversations, INTRO, chairFrom, senderId, yesNo } from "./conversation.ts";
import { inboundFrom } from "./photon.ts";
import type { AgentEvent, ApproveResult, Rollin } from "./rollin.ts";

// the synthetic contract run, marked as a replay the way the web app serves it
const contractRun: AgentEvent[] = readFileSync(new URL("../../contracts/chat_events.example.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => ({ ...JSON.parse(l), replay: true }));

function fake(events: AgentEvent[] = contractRun, replay = true, noPlan: string[] = []) {
  const calls: { approve: [string, boolean][]; run: Record<string, unknown>[] } = { approve: [], run: [] };
  const rollin: Rollin = {
    async run(_m, profile) {
      calls.run.push(profile);
      return { events, replay, reason: "test" };
    },
    async units() {
      return [];
    },
    async hasPlan(sid) {
      return !noPlan.includes(sid);
    },
    async approve(actionId, approved): Promise<ApproveResult> {
      calls.approve.push([actionId, approved]);
      return { action_id: actionId, approved, status: replay ? "not sent: replayed run" : "sent", replay };
    },
  };
  return { rollin, calls };
}

async function talk(c: Conversations, text: string, arrivedAt?: number): Promise<string[]> {
  const out: string[] = [];
  await c.handle("k", text, async (t) => void out.push(t), arrivedAt);
  return out;
}

test("the first reply is an immediate acknowledgement that says it is an AI; later ones do not repeat it", async () => {
  const { rollin } = fake();
  const c = new Conversations(rollin, "http://web.test");
  const first = await talk(c, "27 x 42 chair near the Medical Center");
  assert.equal(first[0], `${INTRO}\n\n${ACK}`);
  assert.match(first[0], /AI agent/);
  const second = await talk(c, "what about 2 bedrooms");
  assert.equal(second[0], ACK);
});

test("the acknowledgement goes out before the agent run finishes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { rollin } = fake();
  const slow: Rollin = { ...rollin, run: async (m, p) => (await gate, rollin.run(m, p)) };
  const c = new Conversations(slow, "http://web.test");
  const out: string[] = [];
  const done = c.handle("k", "27 x 42 chair", async (t) => void out.push(t));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(out, [`${INTRO}\n\n${ACK}`]);
  release();
  await done;
  assert.ok(out.some((t) => t.includes("Top ")));
});

test("every run carries a hashed sender_id, stable per conversation, never the raw handle", async () => {
  const { rollin, calls } = fake();
  const c = new Conversations(rollin, "http://web.test", "imsg");
  await c.handle("+15551234567", "27 x 42 chair", async () => {});
  await c.handle("+15551234567", "what about 2 bedrooms", async () => {});
  const ids = calls.run.map((p) => p.sender_id);
  assert.equal(ids[0], senderId("imsg", "+15551234567"));
  assert.equal(ids[0], ids[1]);
  assert.match(String(ids[0]), /^imsg_[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(calls.run).includes("5551234567"));
  // no chair in the text: none is sent, so memory can supply it
  assert.equal("chair_in" in calls.run[1], false);
});

test("results list at most three units, say they are estimates, link to the plans, then ask", async () => {
  const { rollin, calls } = fake();
  const c = new Conversations(rollin, "http://web.test/");
  const out = await talk(c, "27 x 42 chair near the Medical Center");
  const results = out.find((t) => t.includes("Top "))!;
  assert.match(results, /replayed run/);
  assert.match(results, /estimated/);
  assert.match(results, /^1\. /m);
  assert.doesNotMatch(results, /^4\. /m);
  assert.match(results, /http:\/\/web\.test\/\?sid=/);
  assert.match(out.at(-1)!, /Reply yes or no\.$/);
  assert.deepEqual(calls.run[0], { sender_id: senderId("msg", "k"), chair_in: [27, 42] });
});

test("nothing is approved without a yes; yes approves the action from this run", async () => {
  const { rollin, calls } = fake();
  const c = new Conversations(rollin, "http://web.test");
  await talk(c, "27 x 42 chair");
  assert.equal(calls.approve.length, 0);
  const out = await talk(c, "Yes!");
  assert.deepEqual(calls.approve, [["act_example_001", true]]);
  assert.match(out[0], /Not sent: this was a replayed run/);
  // the question is answered; a second yes starts a new request instead of approving again
  await talk(c, "yes");
  assert.equal(calls.approve.length, 1);
});

test("no declines; any other text is a new request and the question lapses", async () => {
  const { rollin, calls } = fake([...contractRun], false);
  const c = new Conversations(rollin, "http://web.test");
  await talk(c, "27 x 42 chair");
  assert.match((await talk(c, "no"))[0], /won't contact them/);
  assert.deepEqual(calls.approve, [["act_example_001", false]]);
  await talk(c, "27 x 42 chair");
  await talk(c, "actually try 30 x 44");
  assert.equal(calls.approve.length, 1);
  assert.deepEqual(calls.run.at(-1), { sender_id: senderId("msg", "k"), chair_in: [30, 44] });
});

test("a question that failed to send is not left open, and the failure reaches the transport", async () => {
  const { rollin, calls } = fake();
  const c = new Conversations(rollin, "http://web.test");
  const failing = async (t: string) => {
    if (t.endsWith("Reply yes or no.")) throw new Error("send failed");
  };
  await assert.rejects(c.handle("k", "27 x 42 chair", failing));
  await talk(c, "ok");
  assert.equal(calls.approve.length, 0);
});

test("a yes that arrived before the question was asked does not approve", async () => {
  const { rollin, calls } = fake();
  const c = new Conversations(rollin, "http://web.test");
  const typedDuringRun = Date.now();
  await talk(c, "27 x 42 chair");
  const out = await talk(c, "yes", typedDuringRun - 1);
  assert.equal(calls.approve.length, 0);
  assert.match(out[0], /answer the question above/);
  await talk(c, "yes");
  assert.equal(calls.approve.length, 1);
});

test("parsers", () => {
  assert.deepEqual(chairFrom("my 27 × 42 in chair"), [27, 42]);
  assert.deepEqual(chairFrom('27" by 42"'), [27, 42]);
  assert.equal(chairFrom("a 27 inch chair"), null);
  assert.equal(yesNo(" Yes. "), true);
  assert.equal(yesNo("don't send"), false);
  assert.equal(yesNo("ok"), null);
  assert.equal(yesNo("yes but ask about parking"), null);
});

test("only plain-text iMessages from a person to the agent are handled", () => {
  const msg = {
    type: "message.received",
    data: {
      object: {
        id: "msg_1",
        platform: "imessage",
        status: "received",
        sentBy: { kind: "human", handle: "+15550100" },
        receivedBy: { kind: "agent", id: "usr_agent" },
        space: { id: "spc_1" },
        content: { type: "text", format: "plain", text: "hi" },
        createdAt: "2026-11-14T15:00:00Z",
      },
    },
  };
  const { arrivedAt, ...got } = inboundFrom(msg)!;
  assert.ok(Math.abs(arrivedAt - Date.now()) < 1000);
  assert.deepEqual(got, { messageId: "msg_1", spaceId: "spc_1", agentId: "usr_agent", from: "+15550100", text: "hi", createdAt: "2026-11-14T15:00:00Z" });
  assert.equal(inboundFrom({ ...msg, type: "message.delivered" }), null);
  const fromAgent = structuredClone(msg);
  fromAgent.data.object.sentBy.kind = "agent";
  assert.equal(inboundFrom(fromAgent), null);
});

test("the plans link opens a listed unit that has a plan, or the app when none does", async () => {
  const sids = (contractRun.find((e) => e.type === "final")?.shortlist as { sid: string }[]).map((u) => u.sid);
  assert.ok(sids.length >= 2);
  const link = async (noPlan: string[]) => {
    const { rollin } = fake(contractRun, true, noPlan);
    const out = await talk(new Conversations(rollin, "http://web.test/"), "27 x 42 chair");
    return out.find((t) => t.includes("Top "))!;
  };
  const all = await link([]);
  assert.match(all, /See the plans: http:\/\/web\.test\/\?sid=/);
  const second = await link([sids[0]]);
  assert.match(second, /couldn't open the floor plan for unit 1, so this opens unit 2\): http:\/\/web\.test\/\?sid=/);
  assert.ok(second.includes(`sid=${encodeURIComponent(sids[1])}`));
  const none = await link(sids);
  assert.match(none, /I couldn't open the floor plans for these \d\. Browse the units whose plans open: http:\/\/web\.test$/m);
  assert.doesNotMatch(none, /\?sid=/);
});
