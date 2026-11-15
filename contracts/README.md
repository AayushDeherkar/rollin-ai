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
- Panorama checks are `finding` events with `scenario: "panorama check"`, `label: "from defurnished panorama, estimated"`, `findings[]` of `{item, question, answer, note, basis: "estimated", label}` (`bathing`: bathtub / roll_in_shower / step_in_shower / unclear; `grab_bars` and `threshold`: yes / no / unclear), `image_url` (`GET /api/vision/{sid}/{pano_id}`: the side views and floor view the answer was based on) and `evidence: {kind: "pano", pano_id, image_url}`. They carry no room `status` (that comes from the fit engine for the run's own chair). Multi-floor units are not checked. They come from a cached vision pass (`python -m engine.vision <sid>`), never from the chat model.
- `memory` (new type, right after `plan`) says what profile memory did for this `sender_id`: `action` is `saved`, `updated` or `used`; `text` is one line for the trace ("Using the 27x42 in chair from your last request."); `profile.chair_in` values carry `basis: asked` with `source: memory` (reused) or `source: user` (stated now); `path` is the file in the agent's filesystem memory. No `memory` event is sent without a `sender_id`.
- `plan.profile` (optional) echoes the profile the run uses: `{sender_id, chair_in: [Num, Num]}`. The live agent sends it whenever a chair size or `sender_id` is known.
- Every event has `id`, `ts` (ISO 8601 UTC), `run_id`, `type`.
- `type` is one of `plan`, `memory`, `tool`, `finding`, `verify`, `aerial`, `approval_needed`, `final`.
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

## Delivery and leasing-office answers (round 5, additive)
For the messaging bridge, which delivers approved messages:
| Request | Returns |
|---|---|
| `GET /api/outbox` | `{total, items:[{id, to, text, sid, questions, queued_at, status:"pending", delivered_at:null, via:null}]}`: approved messages not yet delivered, oldest first. `questions[n-1]` is the line numbered `n.` in the text as sent. Before approval, every outgoing text is normalised: numbered lines that are not complete questions are dropped, the rest are renumbered from 1, and at most 4 are kept. The `approval_needed` draft shows this exact text. `sid` is the unit the orchestrator passed to `send_message`, or the only unit drafted for that recipient; it is null when neither is known, and the agent never guesses. |
| `POST /api/outbox/{id}/delivered` `{via?: "imessage", detail?}` | The item with `status:"delivered"`, `delivered_at` and `via`. Returns 409 if it was already marked, 404 if the id is unknown and 400 if the id is malformed. |
| `POST /api/answers` `{outbox_id? \| sid?, text?, answers?:[{room, clear_width_in?, answer?}], from?}` | `{answer_id, sid, rooms:[{room_id, label, clear_in, said}], unmatched:[...]}`. A reply is matched in one of three ways: by structured `answers` (`room` is a label or room id); by numbered lines (`2. ...` answers question 2 of the queued message); or by lines that name an unknown room's label. A width counts only when it is written in inches (feet and inches are converted, so 2'10" is 34 in). Heights, values outside 18-60 in, and a line that states two different widths all leave the width unknown. Lines and answers that match no unknown room are listed in `unmatched` and change nothing. |
| `GET /api/events` (SSE) | `delivered` and `answer` events. These are not part of any chat run, so the UI should keep this stream open. Sends `Last-Event-ID` to receive missed events (up to the last 100). |

- `delivered` event: `{id, ts, run_id: null, type: "delivered", outbox_id, sid, to, via, delivered_at, text}`.
- `answer` event: `{id, ts, run_id: null, type: "answer", answer_id, sid, outbox_id, rooms:[{room_id, label, basis: "asked", source: "landlord", clear_in: Num}], unmatched, text}`.
- `GET /api/units/{sid}`: once a room that was `unknown` has an answer, it gains `basis: "asked"` and `answer: {clear_in: Num, said, answer_id, answered_at}`. `clear_in` is `{value, unit: "in", basis: "asked", source: "landlord"}`, or `{value: null, basis: "unknown"}` when the reply gave no width. The room's `status` stays `unknown`, because one door's width does not prove the chair can get there. Rooms that already had a verdict are never changed by an answer.
- The agent stops asking about rooms that have already been answered.
- `POST /api/approve` also returns `outbox_id` (the queued message's id, for `POST /api/outbox/{id}/delivered`) and `outbox_ids` (all of them, in outbox order, when one approval queues several). Both are `null` and `[]` when nothing was queued: declined, replayed, or no live agent attached.

## Insights (round 5, additive)
`GET /api/insights` returns `{sweep, chair_presets, note}`:
- `sweep` is `data/insights.json` (tracked; aggregates only, no unit ids), written by `python -m engine.sweep`, or `null` if no sweep has run. It contains:
  - `scope: {area, radius_km, units, failed}`, `definitions`, `length_rule: {text, basis: "assumed"}` and `basis: "estimated"`;
  - `sweep: [{width_in, length_in, fully_reachable, fully_reachable_with_hinges, unlocked_by_hinges, no_blocked_room, no_blocked_room_with_hinges}]` for widths 22 to 32 in;
  - `at_reference_chair: {chair_in, fully_reachable, unlocked_by_hinges, blocking_room_types: [{type, blocked, rooms, share_blocked}], blocking_doors, blocking_door_clear_in_histogram: [{from_in, to_in, doors}], clear_width_basis}`.
- `chair_presets: [{name, width_in, length_in, source: {title, url, checked}}]` comes from `data/chair_presets.json`. The README's "Sources" section explains where each figure comes from.
- `note` is a string only when no sweep exists yet.

## Changing a contract
Edit the generator, rerun it, run `pytest`, open a PR, and tell the other person what changed.
