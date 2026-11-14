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

## Unit result fields added in contract v2 (additive)
- `rooms[].path` is still `[[x, y, heading_rad], ...]` for reachable rooms. For **blocked** rooms it is now the chair's drive up to the door that stops it, ending at the chair centre nearest that door on the reachable side. It is `null` (and so is `blocking_door_edge`) when no measured door on the way connects to a room the chair reached. That happens when the room is unknown, when the chair fits nowhere in the start room, when the room is reached only through an open passage that is too tight, or when its only door leads outside the unit.
- `rooms[].blocking_door_edge` is the `edge` id (it matches `floors[].doors[].edge`) of the door where the chair stops on its way to a blocked room, or `null`. This may be the door of an intermediate room, for example a bathroom reached through a blocked bedroom.
- `rooms[].turning_space.center` is the `[x, y]` (metres, model frame) of the largest turning circle (walls only).

## Chat events
- Every event has `id`, `ts` (ISO 8601 UTC), `run_id`, `type`.
- `type` is one of `plan`, `tool`, `finding`, `verify`, `approval_needed`, `final`.
- Every number is wrapped: `{"value": 26.0, "unit": "in", "basis": "estimated"}`. An unknown number is `{"value": null, "basis": "unknown"}`.
- `basis` is one of:
  - `measured`: straight from the scan (door widths, walls, coordinates).
  - `estimated`: derived by us (clear width = opening minus 5 cm, turning circle, scores, counts).
  - `assumed`: a fixed assumption (offset hinges add ~1.75 in).
  - `asked`: told to us by a person, with `source` (`user` for the chair size; `landlord` for answers).
  - `unknown`: not in the data; becomes a question.
- Replayed runs (`POST /api/chat?replay=1`) add `replay: true` and `recorded_ts` (the original time) to every event, and suffix `action_id` with the replay's `run_id`. Live runs never set `replay`.
- `approval_needed` carries an `action_id`; the stream then ends with `final` listing `awaiting_approval`. The web/iMessage side calls `POST /api/approve {action_id, approved}`.

## Changing a contract
Edit the generator, rerun it, run `pytest`, open a PR, and tell the other person what changed.
