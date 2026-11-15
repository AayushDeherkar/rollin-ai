# messaging: Rollin' over iMessage (Photon 2.0)

A case manager texts the agent. The bridge posts the text to the web app's `/api/chat`, replies with the top three units and a link to their plans, then asks before contacting anyone. "yes" or "no" goes to `/api/approve`.

```
iPhone ──iMessage──► Photon 2.0 ──Socket.IO──► messaging/ ──HTTP──► web/ /api/chat, /api/approve ──► agent/
       ◄─────────── messaging API ◄───────────┘
```

- Every request gets an immediate acknowledgement ("Checking units now…"); the shortlist follows when the run finishes, about half a minute later. The first acknowledgement in a conversation also says it is an AI agent.
- Each run sends `sender_id` in the profile (contract v3): `imsg_` plus a hash of the conversation, so the agent's memory carries across texts (the chair size from an earlier text is reused) and the phone number never reaches the agent. A chair size in the text wins; without one, none is sent and memory may supply it.
- Nothing is sent to a third party without a "yes" in the same conversation. Any other text starts a new search, and the open question lapses.
- When the web app has no live agent, it replays a recorded run. The bridge then says "This is a replayed run, not a live search", and a "yes" answers "Not sent".
- Counts are labelled as estimates from the floor plans.
- The bridge uses Photon 2.0 (beta): `@photon-ai/api` and `https://api.photon.codes/v1`. It does not use `spectrum-ts`, which is the separate Stable product. Inbound messages arrive over Photon's Socket.IO event stream, so the demo laptop needs no public URL or tunnel. The stream cursor is kept in `.state/` (gitignored), so a restart resumes where it stopped.

## Try it without Photon

You need Node 20.12 or newer, and the web app running (`cd web && npm run dev`).

```bash
cd messaging
npm install
npm run console
```

Type as the case manager, for example `27 x 42 in chair near the Medical Center`, then `yes`.

## Set up Photon (Aarohi)

1. Sign in at app.beta.photon.codes, which is the beta dashboard. Create or choose a project. Its id starts with `pho_prj_`.
2. Create a project API key with `project:read` and `project:write`. It starts with `pho_sk_`. Copy it once and keep it only in `messaging/.env`.
3. Open the project's iMessage page. Under "Add the number you or your user will send from", enter the phone that will text the agent (the case-manager phone for the demo), in E.164 form, e.g. `+1…`. Then "Assign a number from the shared pool". The assigned number is the agent's number; save it in your contacts as "Rollin'". This needs a plan with shared iMessage capacity; check plans before assigning.
4. Make the env file and fill in the key and project id. Set `PHOTON_ALLOWED_SENDERS` to the phone from step 3 so the agent answers only that sender.
   ```bash
   cp .env.example .env
   ```
5. Run the API and web app as described in `web/README.md`, then start the bridge:
   ```bash
   npm start
   ```
   It should print "Listening for iMessages".
6. From the phone in step 3, text the agent's number first. A shared line cannot send the first message. You should get the AI introduction with the "Checking units" acknowledgement at once, then the top three, and the approval question. Text again without a chair size: the agent should reuse the chair it remembered.
7. For links that open on a phone, set `ROLLIN_PUBLIC_WEB_URL` to an address the phone can reach. Otherwise the link points at the laptop's localhost. A quick tunnel works well, against a production build (the dev server refuses other origins):
   ```sh
   cd web && npm run build && npx next start -p 3200   # with ROLLIN_API_URL set, as for dev
   cloudflared tunnel --url http://localhost:3200      # prints https://<random>.trycloudflare.com
   ```
   Put the printed URL in `ROLLIN_PUBLIC_WEB_URL` and restart the bridge. Anyone with that URL can open the app while the tunnel runs; stop it after the demo.

The beta supports text and images only, so the bridge sends plain text.

If nothing arrives, check Event Deliveries under API Activities in the dashboard. Also check that the sender matches the assigned identity exactly: a phone number and an Apple-account email are different senders.

## Deliver approved messages to the leasing office

The bridge has two roles, kept apart:

- **Client**: the numbers in `PHOTON_ALLOWED_SENDERS`. They talk to Rollin' and approve messages.
- **Leasing office**: `LEASING_OFFICE_NUMBER`, one number. It only answers questions; nothing it texts is taken as a request or an approval. Do not add it to `PHOTON_ALLOWED_SENDERS`: the bridge refuses to start if one number is both.

Set `LEASING_OFFICE_NUMBER` in `.env` (gitignored) to the phone playing the leasing office.

1. The bridge uses the office's existing conversation on the Photon project (it looks it up at start). If the office has never texted, it waits for a first text. That text gets one line back, saying it is Rollin', an AI assistant, and that approved questions will come to this number. The bridge never texts a number that has not texted it.
2. When a message is approved (on the web or by "yes" in iMessage), the bridge reads `GET /api/outbox` every few seconds, texts the message into the office's conversation, marks it delivered, and texts the client that it went out. While the office has not texted yet, the client is told once that the questions are waiting. Messages queued before the bridge started are never sent; the log lists them once.
3. The office's next texts are forwarded to `POST /api/answers` as the answer to the last message delivered. The web page shows "Sent", then "The leasing office replied", and the answered room is marked "asked".
4. The findings are texted back into the client's own conversation (the one that texted last before the message went out): the office's words, and what was logged on the plan, marked "as told by the leasing office, not measured". Nothing is sent back to the office, and the bridge ignores its own texts, so there are no loops.

Without `LEASING_OFFICE_NUMBER`, approved messages stay in the outbox.

## Files

- `src/conversation.ts`: the conversation, with no messaging service in it.
- `src/rollin.ts`: calls to the web app, including SSE parsing.
- `src/photon.ts`: the Photon transport (event stream in, messaging API out).
- `src/main.ts`: the bridge (`npm start`).
- `src/deliver.ts`: the two roles, delivery of approved messages to the leasing office, and its replies back as answers and as findings to the client.
- `src/console.ts`: the terminal stand-in (`npm run console`).
- `npm test`: tests the conversation rules against `contracts/chat_events.example.jsonl`.
- `npm run check`: typechecks.

Libraries: `@photon-ai/api` (Photon 2.0 client), `socket.io-client`, `tsx`, `typescript`.
