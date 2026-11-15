import { test } from "node:test";
import assert from "node:assert/strict";
import { Deliverer, OFFICE_ACK, sameHandle, type DeliveryState, type LeasingLine, type OutboxApi, type OutboxItem } from "./deliver.ts";

const OFFICE = "+15550100000";
const T0 = new Date("2026-11-15T01:00:00Z");
const item = (id: string, queued: string, sid: string | null = "synthetic_demo"): OutboxItem => ({
  id,
  to: "Leasing office (synthetic)",
  text: `Hi, this is an AI assistant. Question for ${id}`,
  sid,
  queued_at: queued,
  status: "pending",
});

function rig(items: OutboxItem[], state: DeliveryState = { line: null, lastDelivered: null }) {
  const sent: { line: LeasingLine; text: string; key: string }[] = [];
  const marked: string[] = [];
  const answers: Record<string, unknown>[] = [];
  const logs: string[] = [];
  let saved = state;
  const api: OutboxApi = {
    async pending() {
      return items.filter((i) => !marked.includes(i.id));
    },
    async markDelivered(id) {
      marked.push(id);
    },
    async answer(body) {
      answers.push(body);
      return { rooms: [{ label: "Closet" }], unmatched: [] };
    },
  };
  const d = new Deliverer(
    OFFICE,
    api,
    async (line, text, key) => {
      sent.push({ line, text, key });
    },
    { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) },
    (s) => logs.push(s),
    T0,
  );
  return { d, sent, marked, answers, logs, saved: () => saved };
}

test("nothing is sent until the leasing office has texted the line", async () => {
  const r = rig([item("20261115T010500_aaaaaa", "2026-11-15T01:05:00Z")]);
  await r.d.start();
  await r.d.tick();
  assert.equal(r.sent.length, 0);
  assert.match(r.logs.join("\n"), /has to text this line first/);
  const first = await r.d.fromOffice(OFFICE, "space1", "agent1", "Hi, this is the leasing office");
  assert.equal(first.reply, OFFICE_ACK);
  await r.d.tick();
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].line.spaceId, "space1");
  assert.equal(r.sent[0].key, "rollin:outbox:20261115T010500_aaaaaa");
  assert.deepEqual(r.marked, ["20261115T010500_aaaaaa"]);
  // the first text opened the line; it is not taken as an answer
  assert.equal(r.answers.length, 0);
});

test("messages queued before the bridge started are never sent", async () => {
  const r = rig([item("20261114T200000_bbbbbb", "2026-11-14T20:00:00Z")], { line: { handle: OFFICE, spaceId: "s", agentId: "a", openedAt: "x" }, lastDelivered: null });
  await r.d.start();
  await r.d.tick();
  await r.d.tick();
  assert.equal(r.sent.length, 0);
  assert.equal(r.logs.filter((l) => l.includes("queued before")).length, 1);
});

test("a reply after a delivery is forwarded as the answer to that message", async () => {
  const r = rig([item("20261115T010500_cccccc", "2026-11-15T01:05:00Z")], { line: { handle: OFFICE, spaceId: "s", agentId: "a", openedAt: "x" }, lastDelivered: null });
  await r.d.start();
  await r.d.tick();
  const said = await r.d.fromOffice(OFFICE, "s", "a", "1. The closet door is 30 inches");
  assert.deepEqual(r.answers[0], { outbox_id: "20261115T010500_cccccc", sid: "synthetic_demo", text: "1. The closet door is 30 inches", from: "leasing office" });
  assert.match(said.log, /Closet/);
  assert.equal(said.reply, null);
});

test("the office's first text gets one acknowledgement; later ones go to /api/answers, never back as replies", async () => {
  const r = rig([item("20261115T010500_ffffff", "2026-11-15T01:05:00Z")]);
  await r.d.start();
  const first = await r.d.fromOffice(OFFICE, "s", "a", "Hello, can you see this?");
  assert.equal(first.reply, OFFICE_ACK);
  assert.match(OFFICE_ACK, /AI assistant/);
  assert.ok(!OFFICE_ACK.includes("\n"));
  assert.equal(r.answers.length, 0);
  // a second text before anything was delivered: nothing to answer, and no second acknowledgement
  const early = await r.d.fromOffice(OFFICE, "s", "a", "Hello?");
  assert.equal(early.reply, null);
  assert.equal(r.answers.length, 0);
  await r.d.tick();
  const later = await r.d.fromOffice(OFFICE, "s", "a", "2. The bathroom door is 32 inches");
  assert.equal(later.reply, null);
  assert.deepEqual(r.answers[0], { outbox_id: "20261115T010500_ffffff", sid: "synthetic_demo", text: "2. The bathroom door is 32 inches", from: "leasing office" });
  // after a restart the line is kept: the office is not acknowledged again
  const again = rig([], r.saved());
  await again.d.start();
  assert.equal((await again.d.fromOffice(OFFICE, "s", "a", "3. Closet is 28 in")).reply, null);
  assert.equal(again.answers.length, 1);
});

test("a number that is not the office gets nothing from the office path", async () => {
  const r = rig([]);
  await r.d.start();
  const got = await r.d.fromOffice("+15550100001", "s", "a", "find me a place");
  assert.equal(got.reply, null);
  assert.equal(r.answers.length, 0);
});

test("handles compare loosely", () => {
  assert.ok(sameHandle("+1 (555) 010-0000", "5550100000"));
  assert.ok(sameHandle("Office@Example.com", "office@example.com"));
  assert.ok(!sameHandle("+15550100000", "+15550100001"));
  assert.ok(!sameHandle("", ""));
});

test("a line saved for another number is dropped, so nothing goes to it", async () => {
  const r = rig([item("20261115T010500_dddddd", "2026-11-15T01:05:00Z")], {
    line: { handle: "+15550100099", spaceId: "old", agentId: "a", openedAt: "x" },
    lastDelivered: { id: "20261115T000000_eeeeee", sid: null },
  });
  await r.d.start();
  await r.d.tick();
  assert.equal(r.sent.length, 0);
  assert.deepEqual(r.saved(), { line: null, lastDelivered: null });
});
