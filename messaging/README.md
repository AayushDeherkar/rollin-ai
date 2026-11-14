# messaging: Rollin' over iMessage (Photon 2.0)

A case manager texts the agent. The bridge posts the text to the web app's `/api/chat`, replies with the top three units and a link to their plans, then asks before contacting anyone. "yes" or "no" goes to `/api/approve`.

```
iPhone ──iMessage──► Photon 2.0 ──Socket.IO──► messaging/ ──HTTP──► web/ /api/chat, /api/approve ──► agent/
       ◄─────────── messaging API ◄───────────┘
```

- The first reply in a conversation says it is an AI agent.
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
6. From the phone in step 3, text the agent's number first. A shared line cannot send the first message. You should get the AI introduction, a "Checking units" note, the top three, and the approval question.
7. For links that open on a phone, set `ROLLIN_PUBLIC_WEB_URL` to an address the phone can reach. Otherwise the link points at the laptop's localhost.

The beta supports text and images only, so the bridge sends plain text.

If nothing arrives, check Event Deliveries under API Activities in the dashboard. Also check that the sender matches the assigned identity exactly: a phone number and an Apple-account email are different senders.

## Files

- `src/conversation.ts`: the conversation, with no messaging service in it.
- `src/rollin.ts`: calls to the web app, including SSE parsing.
- `src/photon.ts`: the Photon transport (event stream in, messaging API out).
- `src/main.ts`: the bridge (`npm start`).
- `src/console.ts`: the terminal stand-in (`npm run console`).
- `npm test`: tests the conversation rules against `contracts/chat_events.example.jsonl`.
- `npm run check`: typechecks.

Libraries: `@photon-ai/api` (Photon 2.0 client), `socket.io-client`, `tsx`, `typescript`.
