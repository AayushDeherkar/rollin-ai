/**
 * npm start: the iMessage bridge. Needs PHOTON_API_KEY and PHOTON_PROJECT_ID (see .env.example)
 * and the web app running at ROLLIN_WEB_URL.
 */
import path from "node:path";
import { ApiError } from "@photon-ai/api";
import { Conversations } from "./conversation.ts";
import { photonClient } from "./photon.ts";
import { webRollin } from "./rollin.ts";

const env = (name: string) => process.env[name]?.trim() ?? "";
const missing = ["PHOTON_API_KEY", "PHOTON_PROJECT_ID"].filter((n) => !env(n));
if (missing.length) {
  console.error(`Missing ${missing.join(" and ")}. Copy .env.example to .env and fill it in (see README).`);
  console.error("To try the conversation without Photon, run: npm run console");
  process.exit(1);
}
if (!env("PHOTON_PROJECT_ID").startsWith("pho_prj_")) {
  console.error("PHOTON_PROJECT_ID should start with pho_prj_ (the key starts with pho_sk_; they are easy to swap).");
  process.exit(1);
}

const webUrl = env("ROLLIN_WEB_URL") || "http://localhost:3000";
const publicUrl = env("ROLLIN_PUBLIC_WEB_URL") || webUrl;
const photon = photonClient({
  apiKey: env("PHOTON_API_KEY"),
  projectId: env("PHOTON_PROJECT_ID"),
  allowedSenders: env("PHOTON_ALLOWED_SENDERS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  stateDir: path.join(import.meta.dirname, "..", ".state"),
});
const conversations = new Conversations(webRollin(webUrl), publicUrl);
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

await photon.listen(async (m) => {
  log(`Message ${m.messageId} received.`);
  let n = 0;
  await conversations.handle(m.spaceId, m.text, async (text) => {
    n += 1;
    try {
      await photon.reply(m, text, n);
    } catch (err) {
      log(err instanceof ApiError ? `Photon API error ${err.status} (request ${err.requestId ?? "unknown"}).` : `Send failed: ${String(err)}`);
      throw err;
    }
  });
}, log, () => process.exit(1));
