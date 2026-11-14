/**
 * npm run console: the same conversation in the terminal, with no Photon account.
 * You type as the person texting; the agent's replies print below. Needs the web app at
 * ROLLIN_WEB_URL (default http://localhost:3000), which replays a recorded run if no agent is live.
 */
import { createInterface } from "node:readline/promises";
import { Conversations } from "./conversation.ts";
import { webRollin } from "./rollin.ts";

const webUrl = process.env.ROLLIN_WEB_URL?.trim() || "http://localhost:3000";
const conversations = new Conversations(webRollin(webUrl), process.env.ROLLIN_PUBLIC_WEB_URL?.trim() || webUrl);
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log(`Texting the agent through ${webUrl}. Ctrl+D to stop.\n`);
// stamp each line when typed, the way the bridge stamps a text when it arrives
let last: Promise<void> = Promise.resolve();
rl.on("line", (line) => {
  if (!line.trim()) return;
  const arrivedAt = Date.now();
  last = conversations
    .handle("console", line, async (text) => void console.log(`\nRollin':\n${text}\n`), arrivedAt)
    .catch(() => {});
});
rl.on("close", () => void last.then(() => process.exit(0)));
