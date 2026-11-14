import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversations, INTRO, chairFrom, yesNo } from "./conversation.ts";
import { inboundFrom } from "./photon.ts";
import type { AgentEvent, ApproveResult, Rollin } from "./rollin.ts";

// the synthetic contract run, marked as a replay the way the web app serves it
const contractRun: AgentEvent[] = readFileSync(new URL("../../contracts/chat_events.example.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => ({ ...JSON.parse(l), replay: true }));

function fake(events: AgentEvent[] = contractRun, replay = true) {
  const calls: { approve: [string, boolean][]; run: Record<string, unknown>[] } = { approve: [], run: [] };
  const rollin: Rollin = {
    async run(_m, profile) {
      calls.run.push(profile);
      return { events, replay, reason: "test" };
    },
    async units() {
      return [];
    },
    async approve(actionId, approved): Promise<ApproveResult> {
      calls.approve.push([actionId, approved]);
      return { action_id: actionId, approved, status: replay ? "not sent: replayed run" : "sent", replay };
    },
  };
  return { rollin, calls };
}

async function talk(c: Conversations, text: string): Promise<string[]> {
  const out: string[] = [];
  await c.handle("k", text, async (t) => void out.push(t));
  return out;
}

test("the first reply says it is an AI; later ones do not repeat it", async () => {
  const { rollin } = fake();
  const c = new Conversations(rollin, "http://web.test");
  const first = await talk(c, "27 x 42 chair near the Medical Center");
  assert.equal(first[0], INTRO);
  assert.match(first[0], /AI agent/);
  const second = await talk(c, "what about 2 bedrooms");
  assert.notEqual(second[0], INTRO);
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
  assert.deepEqual(calls.run[0], { chair_in: [27, 42] });
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
  assert.deepEqual(calls.run.at(-1), { chair_in: [30, 44] });
});

test("parsers", () => {
  assert.deepEqual(chairFrom("my 27 × 42 in chair"), [27, 42]);
  assert.deepEqual(chairFrom('27" by 42"'), [27, 42]);
  assert.equal(chairFrom("a 27 inch chair"), null);
  assert.equal(yesNo(" Yes. "), true);
  assert.equal(yesNo("don't send"), false);
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
      },
    },
  };
  assert.deepEqual(inboundFrom(msg), { messageId: "msg_1", spaceId: "spc_1", agentId: "usr_agent", from: "+15550100", text: "hi" });
  assert.equal(inboundFrom({ ...msg, type: "message.delivered" }), null);
  const fromAgent = structuredClone(msg);
  fromAgent.data.object.sentBy.kind = "agent";
  assert.equal(inboundFrom(fromAgent), null);
});
