# Contracts (shared between engine/agent and web/messaging)

Every file here is generated from **synthetic apartments** (`tests/synthetic_demo.json`, `tests/synthetic_1br.json`) by:

```bash
python contracts/make_examples.py
```

No real Matterport, CoStar or Vexcel data is ever stored here. Lat/lon values are invented and every row says `"synthetic": true`.

| File | Endpoint | What it shows |
|---|---|---|
| `unit_result.example.json` | `GET /api/units/{sid}` | Engine output as scanned (PLAN section 5). Bedroom is **blocked**: 28.0 in door, ~26.0 in clear, 1.0 in short. |
| `unit_result.hinges.example.json` | `GET /api/units/{sid}?hinges=1` | Same unit with offset hinges: bedroom flips to **reachable**; bathroom stays blocked; closet stays unknown. |
| `units_list.example.json` | `GET /api/units` | `{query, total, units:[...], source}`, ranked by `score` (share of rooms reachable; unknown counts as not reached), ties: fewer blocked first. Each unit also has `distance_km` (from the query point), `with_hinges: {score, counts, summary}` (same unit with offset hinges) and `usable`. `?hinges=true` ranks by the hinges scores. `source` says where the list came from (batch run time, units processed, scans with no data). |
| `chat_events.example.jsonl` | `POST /api/chat` (SSE) | One full agent run, one JSON event per line. |
| `unit_result.synthetic_1br.example.json` (+ `.hinges.`) | `GET /api/units/synthetic_1br` | The second shortlisted unit's plan. Every unit named in `final.shortlist` has a plan example (`unit_result.example.json` for `synthetic_demo`, `unit_result.<sid>.example.json` otherwise); fixture mode can open them once the web fixture loader reads that name. |
| `profile.example.json` | `POST /api/chat` body `profile` | The person's profile; see "Chat profile" below. |

## Chat profile (request body of `POST /api/chat`: `{message, profile}`)
| Field | Type | Meaning |
|---|---|---|
| `sender_id` | string, optional | Stable id of who is asking (iMessage handle hash, web session). Profile memory is used only when it is present; without it every request stands alone. |
| `chair_in` | `[width, length]` or `null` | Mobility device size in inches; `null` or missing means "not given" (memory or the message may supply it). |
| `turning_in` | number | Turning circle needed, in inches (60 = ADA). |
| `needs` | string[] | Must-haves, from: `bedroom`, `bathroom`, `roll_in_shower`, `step_free_entry`, `elevator`, `parking`. |
| `budget` | `{max_monthly_usd}` | Optional rent ceiling. |
| `area` | `{label, lat, lon, radius_km}` | Where to search. |
| `beds` | int[] | Acceptable bedroom counts (0 = studio). |

Every field is optional. Numbers the person gives are reported back in events with `basis: "asked", source: "user"`.

## Unit result fields added in contract v2 (additive)
- `rooms[].path` is still `[[x, y, heading_rad], ...]` for reachable rooms. For **blocked** rooms it is now the chair's drive up to the door that stops it, ending at the chair centre nearest that door on the reachable side. It is `null` (and so is `blocking_door_edge`) when no measured door on the way connects to a room the chair reached. That happens when the room is unknown, when the chair fits nowhere in the start room, when the room is reached only through an open passage that is too tight, or when its only door leads outside the unit.
- `rooms[].blocking_door_edge` is the `edge` id (it matches `floors[].doors[].edge`) of the door where the chair stops on its way to a blocked room, or `null`. This may be the door of an intermediate room, for example a bathroom reached through a blocked bedroom.
- `rooms[].turning_space.center` is the `[x, y]` (metres, model frame) of the largest turning circle (walls only).

## Chat events
- `final.shortlist[]` only names units the run checked with `run_fit` (so each has a plan).
- `memory` (new type, right after `plan`) says what profile memory did for this `sender_id`: `action` is `saved`, `updated` or `used`; `text` is one line for the trace ("Using the 27x42 in chair from your last request."); `profile.chair_in` values carry `basis: asked` with `source: memory` (reused) or `source: user` (stated now); `path` is the file in the agent's filesystem memory. No `memory` event is sent without a `sender_id`.
- `plan.profile` (optional) echoes the profile the run uses: `{sender_id, chair_in: [Num, Num]}`. The live agent sends it whenever a chair size or `sender_id` is known.
- Every event has `id`, `ts` (ISO 8601 UTC), `run_id`, `type`.
- `type` is one of `plan`, `tool`, `finding`, `verify`, `aerial`, `approval_needed`, `final`.
- `aerial` events give `sid`, `text` (a one-line summary the trace shows), `image_url` (`GET /api/aerial/{sid}`), `label: "from aerial, estimated"` and `findings[]` of `{item, question, answer: yes|no|unclear, note, basis: estimated, label}`. A top-down photo cannot show steps at doors, door widths or elevators, so those are never claimed.
- Every number is wrapped: `{"value": 26.0, "unit": "in", "basis": "estimated"}`. An unknown number is `{"value": null, "basis": "unknown"}`.
- `basis` is one of:
  - `measured`: straight from the scan (door widths, walls, coordinates).
  - `estimated`: derived by us (clear width = opening minus 5 cm, turning circle, scores, counts).
  - `assumed`: a fixed assumption (offset hinges add ~1.75 in).
  - `asked`: told to us by a person, with `source` (`user` for the chair size; `landlord` for answers).
  - `unknown`: not in the data; becomes a question.
- Fields the live agent adds (additive):
  - `plan` has a `source`: `orchestrator` for the fixed pipeline it always emits first, or `model` when the model writes its own todo list.
  - `tool` events can carry `subagent` (for `task`), `agent` and `status` (`called` or `done`).
  - `finding` events carry `scenario` (`as scanned` or `offset hinges on every door`) and `evidence.edge` for the door that stops the chair.
  - `final.shortlist[]` can carry `with_hinges` counts.
- Replayed runs (`POST /api/chat?replay=1`) add `replay: true` and `recorded_ts` (the original time) to every event, and suffix `action_id` with the replay's `run_id`. Live runs never set `replay`.
- `approval_needed` carries an `action_id`; the stream then ends with `final` listing `awaiting_approval`. The web/iMessage side calls `POST /api/approve {action_id, approved}`.

## Changing a contract
Edit the generator, rerun it, run `pytest`, open a PR, and tell the other person what changed.
