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
| `units_list.example.json` | `GET /api/units` | `{query, total, units:[...]}`, ranked by `score` (share of rooms reachable; unknown counts as not reached), ties: fewer blocked first. |
| `chat_events.example.jsonl` | `POST /api/chat` (SSE) | One full agent run, one JSON event per line. |

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
- `approval_needed` carries an `action_id`; the stream then ends with `final` listing `awaiting_approval`. The web/iMessage side calls `POST /api/approve {action_id, approved}`.

## Changing a contract
Edit the generator, rerun it, run `pytest`, open a PR, and tell the other person what changed.
