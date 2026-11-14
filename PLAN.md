# ROLLIN' — Build Plan (HackPrinceton Fall 2026)

> Source of truth for the team and for every coding agent working on this repo.
> Written Saturday Nov 14, 2026, ~4 AM ET. **Submission deadline: Sunday Nov 15, 8:00 AM ET.**
> If something here conflicts with an official HackPrinceton / sponsor document, the official document wins — check and update this file.

---

## 0. TL;DR

**One-liner:** *Your wheelchair just test-drove 200 Houston apartments. Rollin' finds the ones you can actually live in, shows exactly which door stops you, and asks the landlord about the rest.*

**What it is:** an agent that takes a person's real mobility device (width, length), drives it through the measured floor plans of real apartments (Matterport wall graph + door widths), checks the building outside (Vexcel aerial), ranks the units, explains every blocker with evidence, simulates fixes (offset hinges), and — with approval — messages the landlord about anything it could not verify (Photon / iMessage).

**Main track:** Healthcare (only one allowed).
**Special tracks to enter:** CoStar (primary), Amazon Practical AI, LangChain deepagents, Photon (Agents in iMessage, built on Photon 2.0; confirm track requirements), Peri Forward Deployed (only if we complete a real consultation with evidence).

**Status at time of writing:** the core fit engine (`engine/fit.py`) is built and verified on real Matterport data. The demo units are referenced by alias only (`demo-main`, `demo-backup`, `demo-pass`, `demo-sparse`); their ids live in the gitignored `data/demo_units.json`, never in this repo.

---

## 1. Rules that can disqualify us (read first)

From the official HackPrinceton judging document (Fall 2026):

| Rule | What we do |
|---|---|
| Public GitHub repo **created between Nov 13 and Nov 15, 2026**, linked on Devpost | Create repo now; push the starter folder as the first commit |
| Hacking started **8 PM Nov 13**; no project code written before then | All code in this repo was written after 8 PM Nov 13 — keep it that way; do not import old projects |
| Enter **exactly one** HackPrinceton track | Healthcare |
| Special tracks: as many as we want | CoStar, Amazon, LangChain, Photon, (Peri) |
| Submission deadline **Sunday Nov 15, 8:00 AM ET**, hard | Submit by 6:30 AM; freeze features at 2:00 AM |
| Video demo optional, **≤ 2 minutes**, linked on Devpost | Make it (backup if live demo fails) |
| **In-person demo required** Sunday regardless of video; pitch ≤ 2 minutes, must show the problem + a walkthrough | Rehearse 3× |
| Judging 9:30 AM–2:30 PM Sunday; ≥3 general judges; **Special Tracks are judged in round 1 only** | Our first pitch must already be our best pitch |
| Add **Discord usernames** to the Devpost submission | Both of us |
| (From prior HackPrinceton rules) credit every library; overclaiming / embellishing contributions risks disqualification | README "Built with" + "What we built vs. what we used"; disclose AI-assisted coding; label estimates and cached runs on screen |

**Judging criteria (main track):** Creativity (the "ah-ha"), Utility (does it work, how deep, would you use it), Charity (specific societal need), Avidity (visible excitement, Devpost quality, future plans, polish). Best Overall cannot go to a track winner.

---

## 2. The problem and the user

**Person in the pitch:** a patient finishing spinal-cord-injury rehab in Houston's Texas Medical Center. Medically ready to go home, but uses a power chair ~27 in wide that needs a 60 in turning circle. Their hospital case manager has a phone, a list of apartment complexes, and about two weeks.

**Today:** listing sites offer a single accessibility checkbox that the landlord self-reports. Case managers call around, ask "is it accessible?", get "yes", and the patient discovers a 24" bathroom door on move-in day — or never leaves the facility.

**Stats we may use on stage — each marked VERIFY must be checked against the primary source before quoting:**
- < 1% of US housing units are wheelchair accessible; < 5% suit someone with moderate mobility difficulty — HUD, *Accessibility of America's Housing Stock* (2015). **VERIFY**
- Accessible affordable housing is a top barrier to moving people out of nursing homes (KFF survey of Money Follows the Person programs). **VERIFY**
- Fair Housing Act design requirements apply to buildings with 4+ units first occupied after March 13, 1991 (usable doors, accessible route). **VERIFY wording in HUD Fair Housing Act Design Manual.**
If a number can't be verified in 5 minutes, drop it. Never invent statistics.

**Users:** wheelchair and walker users, older adults, and the professionals who search for them (hospital case managers, Medicaid transition coordinators, independent-living centers).
**Buyers (startup path):** rehab hospitals / health systems (fewer avoidable inpatient days), state Medicaid transition programs, Medicaid managed-care plans, listing platforms licensing a "verified fit" badge (CoStar/Apartments.com is the obvious partner).

---

## 3. Why this wins (map to every rubric)

| Rubric | Weight | How Rollin' scores |
|---|---|---|
| HackPrinceton Creativity | holistic | Nobody "drives" a specific person's chair through real measured floor plans at listing scale. Ah-ha: the chair jams red at a door, the agent proposes hinges, re-runs, it turns green. |
| HackPrinceton Utility | holistic | Works on real data today; gives a yes/no/unknown per room with evidence, not a chat answer |
| HackPrinceton Charity | holistic | Disability, discharge delays, housing access |
| HackPrinceton Avidity | holistic | Live, visual demo; clear next steps (pilot with a rehab hospital's case managers) |
| CoStar: use of data (30%) | | Matterport wall graph + door widths + room labels + defurnished panoramas + Vexcel outside view + CoStar records — each layer does a job the others can't |
| CoStar: agentic depth (30%) | | Plans → measures → fails → proposes fix → re-runs → verifies → asks for approval → acts (message landlord) |
| CoStar: usefulness (25%) | | Apartments.com could ship a "verified fit" badge Monday; fixes their self-reported checkbox |
| CoStar: demo/polish (15%) | | Animated chair, before/after toggle, 3D tour jumps to the blocking door |
| Amazon (25% each) | | Creative, useful, technically real (geometry + motion planning), simple UX (text the agent) |
| LangChain deepagents | | Orchestrator + 5 subagents, todo planning, filesystem memory, human-in-the-loop approval |
| Photon | | Case manager texts the agent in iMessage (Photon 2.0); agent replies with shortlist + asks approval before contacting a landlord |

**CoStar's own problem board (from their quickstart) and how we relate:** #3 "agentic annotation" (our agent labels doors/blockers inside the 3D tour as Tags) and their bonus idea "predict CoStar listing amenities from the Matterport models" (we verify or refute the accessibility amenity from geometry). Most teams will build #4 (search inside panoramas) and #6 (refurnish) — we deliberately avoid those.

---

## 4. Data we use (facts verified Nov 14)

### 4.1 Access
- Keys: run `/costar-keys` in the CoStar track Discord. Values: `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`, `VEXCEL_API_KEY`, `COSTAR_ZIP_PASSWORD`, `COSTAR_KIT_URL` (or `COSTAR_KIT_ZIP`).
- Matterport Model API: `POST https://api.matterport.com/api/models/graph`, HTTP basic auth (key = username, token = password). Production endpoint only. **Call it from server-side code**, not the browser.
- Help: `#costar-group` on Discord or `/ask-costar`. People at the CoStar table: Azwad Sabik, Ilia Glazkov, Lucas Hayne (semantic search), Olaf Brandt, Ted Weidling (the API), Guillermo Bruce (Discord).
- Model Playground (GraphiQL with your key): `https://beta-app.matterport.com/2026-princeton-hackathon/graphiql`.
- Quickstart reference: `https://beta-app.matterport.com/2026-princeton-hackathon/quickstart` (ships `models_index.csv` and `AGENTS.md` — download both into `data/`).

### 4.2 What's in the dataset
- 14,945 models: "Commercial Spaces" folder 13,014 (many are apartment units named like `<beds>BR, <baths>BA - <size>SF`), "Residential Spaces" 1,930. 232 have aerial Gaussian splats + drone photos.
- `models_index.csv`: one row per model — sid, name, segment, lat/lon, address, CoStar property id or Homes listing id where known, splat yes/no, pano and room counts, created dates, `ai_summary` flag. The API has **no geo search**; filter this CSV by lat/lon.
- Every model has a **defurnished view** (same panoramas, furniture removed): `view(type: "matterport.model.defurnished") { id }`, then query that id like a model.
- Vexcel: `POST https://api.vexcelgroup.com/v2/ortho/extract` with `X-API-KEY` header; clips a 7.5 cm/px orthophoto to a WKT polygon around lat/lon. Houston and LA only (elsewhere 403). Vexcel's own tutorial (link on the Vexcel keys card) covers parcels, roof attributes, obliques, object detection, embedding search.
- CoStar kit: property and listing records; residential models join via `homes_listing_id` → `residential-listings.csv`; commercial via CoStar property id. **CoStar marks this join "not yet tested."** Treat rent/contact data as optional.

### 4.3 The queries that work (and the pitfalls)
The full query sometimes returns `error.internal` intermittently. **Always split into 3 queries and retry up to 4×.**

```graphql
# Q1 walls + doors
query F($id: ID!) { model(id: $id) { name
  floors { id label vertices { id position { x y } }
    edges { id type thickness vertices { id } openings { width type relativeCenter } } } } }

# Q2 rooms
query R($id: ID!) { model(id: $id) {
  rooms { id floor { id } classifications { label confidence } boundary { edges { id } } } } }

# Q3 room sizes (optional)
query D($id: ID!) { model(id: $id) { rooms { id dimensions(units: metric) { areaFloor width depth } } } }

# Listing models (10 per page; pass nextOffset back as offset)
query L($o: String) { models(query: "*", offset: $o) { totalResults nextOffset results { id name } } }
```
Merge Q1+Q2+Q3 into `{"data":{"model":{name, floors, rooms}}}` — the engine's `--file` format.

**Data facts learned from 21 real apartments:**
- Units typically have 5–13 measured openings; some have only 2. Missing doors → rooms are **unknown**, never failed.
- Opening `type` is `doorway` or `opening`; treat both as passages.
- Opening `height` / `lowerElevation` are unreliable (docs sample shows 0.1 m) — ignore them.
- Openings < 18 in are scan artifacts — flagged, not used.
- Rooms labelled `Void` are ignored; some rooms have no classification or an empty boundary.
- Common real door widths 21–25 in (baths, closets) — this is why so many rooms fail for a 27 in chair.
- Wall-graph coordinates are metres, model frame, Z up. **Showcase SDK uses a different frame**: `api_to_sdk(x, y, z) = (x, z, -y)`.

### 4.4 Known demo units
| alias | role | use |
|---|---|---|
| `demo-main` | Main before/after demo: a bedroom the chair can't enter that offset hinges fix, and a bathroom that stays blocked | **Main demo** |
| `demo-backup` | Same story, second unit | Backup |
| `demo-pass` | Fully reachable contrast | "Pass" contrast |
| `demo-sparse` | Few doors in the scan, so some rooms are unknown | Example of sparse data |

Alias → model id: `data/demo_units.json` (gitignored; share it directly, never through GitHub). CoStar terms: floor plans and property-identifiable data are not republished in this repo.

---

## 5. The fit engine (exists — `engine/fit.py`)

**Usage**
```bash
python -m engine.matterport <MODEL_ID>          # fetch + cache only
python engine/fit.py <MODEL_ID> [chair_width_in] [chair_length_in] [--hinges]   # uses the cache
python engine/fit.py --file data/cache/<sid>.json [w] [l] [--hinges]
```
Writes `out/<sid>_fit[ _hinges].json` and `out/<sid>_floor<N>_fit[ _hinges].png`.

**Method (say this on stage, briefly)**
1. Build walls from the wall graph; cut gaps only for doors whose **exact** clear width fits the chair (clear = width − 5 cm for leaf and stop; estimate). The grid can't resolve a 1-inch shortfall, so passability is decided from the measured number.
2. Rooms = polygons from each room's boundary edges.
3. Rasterize free space at 5 cm; for 16 headings, compute where the chair centre can sit (obstacles dilated by the rotated chair rectangle).
4. Breadth-first search over (x, y, heading) from the entry (an opening on an edge only one room owns; fallback: largest room).
5. Per room: `reachable` / `blocked` / `unknown` (no measured door, or only a suspect artifact). A blocked room's reason uses only doors the chair could arrive at (from a reached room, else from outside the unit): their shortfall, "route too tight", or "every door leads from a room the chair can't reach".
6. Bathrooms: largest inscribed circle (walls only) vs 60 in.
7. `--hinges`: adds ~1.75 in to every door's clear width (offset/swing-clear hinges recover roughly 1.5–2 in) and re-runs.

**Output contract (`contracts/unit_result.example.json`)**
```jsonc
{
  "model": "synthetic_demo", "name": "Synthetic 1BR (narrow bedroom door)",
  "chair_in": [27.0, 42.0], "scenario": "as scanned" | "offset hinges on every door",
  "floors": [{
    "floor": "0", "start_room": "25",
    "walls":  [{"edge":"z","type":"wall","thickness":0.12,"a":[x,y],"b":[x,y]}],
    "doors":  [{"edge":"z","type":"doorway","width_in":26.0,"clear_in_est":24.0,"passable":false,"center":[x,y]}],
    "artifacts": [{"edge":"...","width_in":1.1}],
    "openings_found": 10, "artifacts_ignored": 0,
    "rooms": [{
      "room_id":"bed","label":"Bedroom","area_m2":9,
      "status":"reachable|blocked|unknown",
      "reason":"widest way in (door from Living Room) ~26.0 in clear < chair 27.0 in (short by 1.0 in); offset hinges ...",
      "doors":[{"type":"doorway","width_in":28.0,"clear_in_est":26.0,"center":[x,y]}],
      "turning_space":{"max_circle_in":59.1,"meets_60in":false,"walls_only":true,"center":[x,y]} | null,
      "path":[[x,y,theta_rad], ...] | null,     // chair centre + heading, metres, model frame; blocked rooms: up to the blocking door (null if no door on the way connects to a reached room)
      "blocking_door_edge":"z" | null,           // door where the chair stops (blocked rooms only)
      "polygon":[[x,y], ...]
    }]
  }]
}
```
This contract is **shared**. Changing it requires a PR that updates `contracts/unit_result.example.json` and pings the other person.

---

## 6. Limitations — how big, and will judges care

| # | Limitation | Size | Will judges care? | What we do |
|---|---|---|---|---|
| L1 | Fixtures (toilet, vanity, tub) are not in the wall graph → bathroom turning space is walls-only and optimistic | Medium | Yes if asked; healthcare judges know bathrooms are the crux | Label "walls only"; vision pass on **defurnished** panoramas flags tub vs roll-in shower and big fixtures; say it plainly |
| L2 | Some scans miss doors → rooms "unknown" | Medium | Mildly; honesty reads well | Unknowns become landlord questions — this *is* the agent's action step |
| L3 | Opening width ≠ clear width (5 cm deduction is an estimate) | Low | Rarely | Show "≈" and "est." in UI |
| L4 | Steps, raised thresholds, door hardware, floor surfaces not in geometry | Medium | Possibly | Vision pass on panos near each door; else "unknown → ask" |
| L5 | In-place rotation approximated (no sweep check between headings) | Low | No | Mention only if asked |
| L6 | Scan stops at the unit door: building entrance, elevator, corridors not scanned | **High for real use** | **Likely asked** | Vexcel outside check (entrance steps/ramp, parking) + ask landlord about elevator; say "unit-level today, building-level next" |
| L7 | Listings may be stale (unit already rented) | Low | Rarely | Frame as "this floor plan in this building" |
| L8 | Not a legal/ADA certification | Medium | Yes (liability) | "Decision support with evidence; final check in person" |
| L9 | CoStar records join untested; landlord contact may be missing | Medium for the "act" step | Only if demo breaks | Demo the outreach to a teammate's phone; disclose |
| L10 | Data covers Houston + LA only | Low | No | Rehab story set in Houston (Texas Medical Center) |
| L11 | Entry door not always identified → start falls back to largest room | Low | No | Shown as "start: largest room (entry not in scan)" |
| L12 | API intermittent `error.internal`; venue Wi-Fi | High for live demo | Yes if it breaks | Pre-fetch and cache all demo units; demo runs from cache; disclose cache |
| L13 | Chair modeled as a rectangle | Low | No | Configurable width/length |
| L14 | Track framing: "this is housing, not health" | Medium | Possibly | Frame as discharge delays / nursing-home transitions; the user is a patient |
| L15 | Prior art: Accessibility Scout (UIST 2025), RASSAR (CHI 2024) do accessibility scans of single spaces | Low | If a judge knows them | Never claim "first ever"; claim "a specific person's device through measured plans at listing scale, then acting on the gaps" |

None of these is a blocker. L6 and L12 are the ones to prepare answers / mitigations for.

---

## 7. Architecture

```
            iMessage (case manager)                Web app (judges / projector)
                     │                                      │
          messaging/ (Photon 2.0, TS)                web/ (Next.js)
                     │   HTTP                               │  HTTP + SSE
                     └──────────────►  agent/ (FastAPI + deepagents, Python)  ◄───┘
                                         │  tools
              ┌──────────────┬───────────┼──────────────┬──────────────┐
         engine/ fit     matterport     vexcel        costar         vision
        (fit.py)   client+cache   ortho clip    kit reader    (defurnished panos)
                                         │
                                  data/ cache (JSON per model, batch results)
```

**Stack:** Python 3.11 (engine + agent + FastAPI), Next.js (App Router) + Tailwind + shadcn/ui + Motion + Lucide for the web, Photon 2.0 (`@photon-ai/api`, Node) for iMessage. Claude as the agent model via the deepagents harness (any supported model works; pick one and pin it). Optional cheap vision model for panorama checks.

**Deployment for the demo:** run everything on one laptop from cache (most reliable). Optionally deploy `web/` to Vercel and expose the FastAPI via a tunnel (e.g. cloudflared) so judges can open it on their phones. The live demo must never depend on venue Wi-Fi.

### 7.1 Agent design (deepagents)
- `create_deep_agent(...)` with: system prompt, tools, subagents, and human-in-the-loop approval on any outbound action. deepagents is a fast-moving beta package (0.7.x as of Aug 2026) — **pin the installed version and read its docs for the exact argument names** before writing code (planning/todos, virtual filesystem, subagents, `interrupt_on`-style approvals).
- **Orchestrator**: receives the person's profile and request; writes a todo plan; delegates; assembles the shortlist; never contacts anyone without approval.
- **Subagents**
  1. `search` — filters `models_index.csv` + cached batch results by area (lat/lon radius), bedrooms (parsed from name), and profile; returns candidate sids.
  2. `geometry` — calls `run_fit(sid, w, l, hinges)`; reads the JSON; explains blockers.
  3. `vision` — for blocked/unknown rooms and bathrooms, pulls defurnished panorama faces nearest the door/bathroom and checks: tub vs roll-in shower, step at entry/balcony, raised threshold, grab bars. Every claim cites a pano id + crop.
  4. `outside` — Vexcel ortho clip around lat/lon; checks visible entrance steps/ramps, accessible parking, curb ramps. Labels everything "from aerial, estimated".
  5. `verifier` — re-checks each claim, marks `measured` / `estimated` / `unknown`; unknowns become questions. (Built as deterministic code, not a model turn: the `verify` event carries `source: "code"`.)
  6. `outreach` — drafts the landlord message (questions about unknowns + the specific fix, e.g. offset hinges on the bedroom door); sends **only after approval**.
- **Memory**: `/memories/profile.json` — device width/length/turning diameter, needs (roll-in shower, no steps), budget, area.
- **Tools (Python functions)**: `search_units(profile)`, `run_fit(sid, w_in, l_in, hinges)`, `get_unit(sid)`, `pano_crops(sid, xy, defurnished=True)`, `aerial_check(lat, lon)`, `costar_record(sid)`, `draft_landlord_message(sid, questions)`, `send_message(to, text)` (approval-gated).

### 7.2 API (FastAPI, owned by A, consumed by B)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/units?lat=&lon=&radius_km=&beds=&w=&l=` | `{query, total, units:[{sid,name,lat,lon,score,counts:{reachable,blocked,unknown},summary,chair_in,scenario,basis,source}]}` ranked; see `contracts/units_list.example.json` |
| GET | `/api/units/{sid}?w=&l=&hinges=` | the engine JSON (section 5) |
| POST | `/api/chat` `{message, profile}` | **SSE stream** of agent events `{id, ts, run_id, type:"plan"|"tool"|"finding"|"verify"|"approval_needed"|"final", ...}`; every number is `{value, unit?, basis}`; see `contracts/chat_events.example.jsonl` |
| POST | `/api/approve` `{action_id, approved}` | result of the gated action |
| GET | `/api/tour/{sid}/nearest-pano?x=&y=` | `{pano_id, sdk_position}` for the 3D tour jump |

Person B builds against `contracts/*.example.json(l)` fixtures until these endpoints exist. Field-by-field notes: `contracts/README.md`.

### 7.3 Web UI (owned by B)
Layout (one screen, projector-first, ≥16 px body text, high contrast, one accent colour):
- **Left:** map (MapLibre) + ranked unit list with green/red/grey counts.
- **Centre:** floor plan canvas (SVG from `walls`, `doors`, `rooms.polygon`): rooms coloured by status, door labels in inches (red if not passable), the chair rectangle animating along `path` with heading. Toggle **"As scanned / With offset hinges"** — the money shot.
- **Centre-bottom:** embedded Matterport tour (public models: `https://my.matterport.com/show/?m=<sid>`; Showcase Embed SDK for `Sweep.moveTo` — check the keys card for an SDK/application key). Clicking a red door jumps the tour to the nearest panorama.
- **Right:** live agent trace (plan → tool → finding → verified/estimated/unknown chips), streaming from `/api/chat`; approval card ("Send these 3 questions to the leasing office?").
- Every finding is clickable to its evidence (door on plan, pano crop, aerial crop).
- Skeleton loaders, empty states, a cached fallback run (labelled "replay").

### 7.4 iMessage (owned by B, Photon 2.0)
- **Photon 2.0** (replaces spectrum-ts): `@photon-ai/api` on npm, `photonhq-api` on PyPI. The beta handles **text and images only**, and a **shared line cannot send the first message**: the case manager has to text the agent first. Cloud dashboard: app.photon.codes. **Confirm the fall track terms at the Photon table or on Discord.**
- Flow: case manager texts "patient leaves TIRR in 2 weeks, 27 in chair, needs roll-in shower, under $1,400" → bridge posts to `/api/chat` → replies with top 3 units + a link to the web view → asks "Want me to message the leasing office about the 2 things I couldn't verify?" → on "yes", calls `/api/approve`.
- Demo recipient for outreach = teammate's phone. The agent identifies itself as an AI.

---

## 8. Task breakdown

### Person A (Aayush) — data, engine, agent (Python)
| # | Task | Done when | Est. |
|---|---|---|---|
| A1 | Create repo, push starter folder, add `.env.example`, `.gitignore`, `requirements.txt` | Both can clone & run engine on `data/cache/<demo-main sid>.json` | 0.5 h |
| A2 | `engine/matterport.py`: client with 3-query split, 4× retry, disk cache `data/cache/<sid>.json` | `python -m engine.matterport <sid>` caches a model | 1 h |
| A3 | `engine/batch.py`: download `models_index.csv`; filter apartments near Texas Medical Center (≈ 29.71 N, −95.40 W — verify) within ~8 km; fetch + run engine for 27×42 chair; write `data/batch/index.json` (ranked) | ≥150 units processed and ranked | 2 h (mostly waiting) |
| A4 | FastAPI `agent/server.py`: `/api/units`, `/api/units/{sid}` from cache | B's UI loads real data | 1 h |
| A5 | deepagents orchestrator + `geometry`, `search`, `verifier`, `outreach` subagents; SSE events on `/api/chat`; approval gate | A full request streams plan→findings→approval | 3 h |
| A6 | `vision` subagent: defurnished pano faces near a door / in bathrooms → fixtures/steps with crop evidence | Bathroom in demo unit gets "tub, no roll-in shower" (or truthful result) | 2 h |
| A7 | `outside` subagent: Vexcel ortho clip + check entrance/parking | Demo unit shows aerial crop + labelled findings | 1.5 h |
| A8 | `costar_record` (optional, only if the kit join works) | Rent/year built shown; else hidden | 1 h |
| A9 | Tests: engine on synthetic + 3 real units; fixtures for B | `pytest` green | 0.5 h |
| A10 | README technical sections, "what we built vs used", AI disclosure | Done | 0.5 h |

### Person B (Aarohi) — product, UI, messaging, story (TypeScript)
| # | Task | Done when | Est. |
|---|---|---|---|
| B1 | `web/` scaffold: Next.js + Tailwind + shadcn/ui + Motion; design tokens; 3-panel layout | Renders with fixtures | 1 h |
| B2 | Floor-plan SVG renderer from contract (walls, doors with inch labels, room polygons by status) | Matches the engine PNG | 2 h |
| B3 | Chair animation along `path` (rect w×l rotated by theta), before/after hinge toggle with animated room colour change | The money shot works on `demo-main` | 2 h |
| B4 | Map + ranked list from `/api/units` | Click unit → loads plan | 1.5 h |
| B5 | Agent trace panel (SSE), evidence chips, approval card | Streams a real run | 2 h |
| B6 | Matterport embed + jump to door (Showcase SDK `Sweep.moveTo`, coordinate conversion) | Click red door → tour moves there | 2 h |
| B7 | `messaging/`: Photon 2.0 iMessage bridge ↔ `/api/chat` / `/api/approve` | Text in, shortlist out, approval works | 2 h |
| B8 | Peri consultation (optional): one real conversation with a case manager / independent-living centre / disability-services office or a relevant student org; capture name, role, evidence (quote/screenshot/photo) | Evidence saved in `docs/peri/` | 1 h |
| B9 | Devpost page, pitch script, video (record backup ~hour 28, final after freeze) | Uploaded, ≤2 min | 2 h |

### Sync points (both)
- **Every 3 hours, 5 minutes:** what's merged, what's blocked, contract changes.
- **Sat 12:00 PM:** real data in UI (A4 + B2/B4).
- **Sat 6:00 PM:** agent streaming into UI (A5 + B5); stretch decisions.
- **Sun 2:00 AM:** feature freeze. Only bug fixes, cache warm-up, video, Devpost.
- **Sun 6:30 AM:** submit. Verify repo public, Devpost links, Discord usernames, all special tracks ticked.

---

## 9. Git workflow (no stepping on each other)

**Ownership by path** (CLAUDE.md is the source of truth):
| Path | Owner |
|---|---|
| `engine/`, `agent/`, `data/`, `tests/`, `requirements.txt`, `contracts/`, `README.md`, `PLAN.md`, `CLAUDE.md`, `.gitignore`, `.env.example`, `.github/` | A (Aayush) |
| `web/`, `messaging/`, `docs/` (and their `package.json` / lockfiles) | B (Aarohi) — requests shared-file changes through the manager |

**Branches**
- `main` is always demoable. Never force-push `main`. Never commit directly to `main` except the very first commit.
- Short-lived branches: `a/<task>` and `b/<task>` (e.g. `a/batch-ranker`, `b/plan-svg`).
- Each Claude Code session / parallel agent works in its **own git worktree**:
  ```bash
  git worktree add ../rollin-a-agent -b a/agent-loop
  git worktree add ../rollin-b-plan  -b b/plan-svg
  ```
- Loop (every ~30–60 min):
  ```bash
  git add -A && git commit -m "b: chair animation along path"
  git fetch origin && git rebase origin/main      # keep up to date
  git push -u origin HEAD
  gh pr create --fill && gh pr merge --squash --delete-branch   # self-merge your own area
  ```
- Merge to `main` only when: it runs, it doesn't touch the other person's directories, and shared files changed only with a heads-up.
- Only the owner edits a lockfile (`package-lock.json` / `bun.lockb` / `requirements.txt`). Need a dependency in the other area? Ask.
- Conflicts in shared files: the person who opened the later PR resolves, keeping both changes.

**Secrets**
- `.env` (gitignored) holds keys; commit `.env.example` with names only. Never paste keys into code, notebooks, commits, Devpost, or screenshots. If a key leaks, run `/costar-keys` again for a new pair.
- `.gitignore` must include: `.env`, `out/`, `node_modules/`, `.next/`, `__pycache__/`, `*.ply`, `*.zip`, `data/raw/`, `data/cache/`, `data/batch/`.
- **Never commit CoStar / Matterport / Vexcel data** (it is "hackathon use only"). Real model JSON lives in `data/cache/` (gitignored); share it between the two of you directly (e.g. a Discord DM zip), not through GitHub. Contract examples in `contracts/` are generated from the synthetic test apartment.

---

## 10. How to use Claude Code (and other tools) well here

- **`CLAUDE.md`** at the repo root (provided) tells every session the rules, ownership, and contract. Keep it short and current.
- **One task per session, one worktree per session.** Give each session a single task ID from section 8, its directory, and the "done when". Review the diff before merging.
- **Plan first** for anything over ~50 lines: ask the agent for a plan, approve it, then build.
- **Contract-first:** B's agents build against `contracts/*.example.json`; A's agents must keep the output matching it (add a test that validates engine output against the example's keys).
- **Parallel sessions:** e.g. A runs "batch ranker" and "agent loop"; B runs "plan SVG + animation" and "iMessage bridge". Superset (Mac app) or plain worktrees + several terminals both work.
- **Voice prompting:** Wispr Flow (free for students for 3 months per its site) speeds up prompt writing.
- **Design:** for UI work, have the session follow a short brief: tokens, the 3-panel layout, projector-first type sizes, one accent colour, every finding linked to evidence. Avoid default-looking templates.
- **Never let an agent:** commit `.env`, rewrite `main` history, edit the other person's directories, or invent data/statistics.

---

## 11. Demo and pitch

### 11.1 The 2-minute pitch
| Time | Content |
|---|---|
| 0:00–0:25 | Already on screen: `demo-main`. The chair glides from the living room, **jams red at the bedroom door, with the shortfall in inches.** Click → 3D tour jumps to that door. Toggle hinges → it turns green. The bathroom stays red: "The agent will ask." |
| 0:25–0:45 | "This is Maria [illustrative]. Spinal-cord injury, rehab in Houston's Medical Center, ready to go home. Her chair is 27 inches. Listing sites give her one checkbox, filled in by the landlord." |
| 0:45–1:25 | Live: case manager texts the agent (iMessage). Trace streams: plan → 180 units checked → 12 fully reachable → top 3 → unknowns → "Approve message to leasing office?" → yes → teammate's phone buzzes. |
| 1:25–1:45 | How: Matterport wall graph + measured doors → motion planning for her exact chair; defurnished panoramas for fixtures; Vexcel for the entrance; deepagents with approval. Estimates are labelled. |
| 1:45–2:00 | Who pays: rehab hospitals and Medicaid transition programs; Apartments.com "verified fit". Next: building entrances and elevators, pilot with case managers. |
Keep a 30-second version for sponsor judges arriving mid-round.

### 11.2 Things to say if asked
- "Is it accurate?" → door widths come straight from Matterport's measured wall graph; clear width and fixtures are estimates and labelled so.
- "What about the building entrance / elevator?" → L6 answer.
- "Isn't this an ADA audit tool?" → no: personalised to one device, at listing scale, and it acts on the gaps.

### 11.3 Devpost checklist
Title, one-liner, problem, what it does, how we built it (stack + data layers), challenges (sparse doors, API retries, grid vs 1-inch precision), what we built vs used + AI-assisted coding disclosure, accomplishments, what's next, video link, GitHub link, Discord usernames, tracks ticked: Healthcare + CoStar + Amazon + LangChain + Photon (+ Peri with evidence).

### 11.4 Video (≤ 2 min)
Same structure as the pitch. Record at 1080p+, browser zoom 125%, notifications off, pre-warmed cache. Tools: Screen Studio or OBS to record; CapCut/DaVinci/Descript to edit; burn-in captions; quiet royalty-free music. Upload unlisted to YouTube.

---

## 12. Timeline (now → deadline)
| Window (ET) | A | B |
|---|---|---|
| Sat 4–6 AM | A1, A2, start A3 batch running | B1, B2 on fixtures |
| Sat 6–10 AM | Sleep (batch runs) | B3 animation + toggle |
| Sat 10 AM–12 PM | A4 API | Sleep |
| Sat 12–6 PM | A5 agent loop, A9 | B4, B5, B6; B8 Peri consult call |
| Sat 6 PM–12 AM | A6 vision, A7 outside, A8 if possible | B7 iMessage, polish, backup video |
| Sun 12–2 AM | Integration, cache warm-up | Integration, Devpost draft |
| Sun 2–6 AM | **Freeze.** Fixes, README | Final video, Devpost, rehearse |
| Sun 6:30 AM | Submit | Submit |
| Sun 9:30 AM | Judging round 1 (sponsors judge only now) | |

Sleep in shifts; at least 4 hours each.

---

## 13. Adopted from the CareSpace spec (decided Sat 04:45)

1. **Voice call to the leasing office (B, stretch, checkpoint Sat 18:00).** After approval, the agent calls the leasing office (a teammate in the demo) through a Photon number + ElevenLabs voice agent over SIP and asks only what the scan can't answer: step-free building entrance? elevator? door widths of the rooms marked unknown? would they install offset hinges on the bedroom door? It logs answers via a server tool, and the room statuses update from `unknown` to `asked`. This fixes limitation L6 on stage, and lets us also enter Photon's **Best Voice Agent**. Setup references: Photon voice quickstart (photon.codes/docs/beta/get-started/voice) and the Photon + ElevenLabs cookbook (photon.codes/docs/beta/cookbooks/voice/elevenlabs) — **VERIFY both in the first hour of B's voice work**. Guardrails: the first sentence says it is an AI and who it represents; it announces the call is recorded for notes; no commitments; it calls only numbers the user entered, after approval. **If the call isn't working by 18:00, cut it** and keep the iMessage outreach.
2. **Basis labels on every number:** `measured` (door widths, walls), `estimated` (clear width, aerial, scores), `assumed` (hinge gain), `asked` (told to us by a person: the user's chair size, answers from the call/landlord), `unknown`.
3. **deepagents human-in-the-loop needs a checkpointer.** Pattern from the teammate's spec (verify against the installed version): `create_deep_agent(..., interrupt_on={"send_message": {...}, "start_call": {...}}, checkpointer=MemorySaver())`, then resume with a `Command(resume=...)`.
4. **LangSmith tracing** (`LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY`) — show the trace to LangChain judges.
5. **Keep Matterport requests under 10/s** (shared keys); our batch job sleeps between calls.
6. **Repo private while building; flip public by Sun 04:00**, then check it in an incognito window (no keys, no data in history). Tag `demo-v1` at 18:00 and `demo-final` at freeze.
7. **Claude Code plugins/MCP the teammate listed** (frontend-design, feature-dev, code-review, security-guidance, commit-commands, context7, playwright, github): useful if they install cleanly via `/plugin` — check each exists before relying on it; don't spend more than 10 minutes on tooling.
8. **11:00 AM:** talk to the CoStar (Ted Weidling for the API), Photon and LangChain reps; show them the before/after and ask what they want to see.
