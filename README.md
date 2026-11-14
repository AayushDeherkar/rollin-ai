# Rollin'

Your wheelchair just test-drove 200 Houston apartments. Rollin' finds the ones you can actually live in, shows exactly which door stops you, and asks the landlord about the rest.

Built at HackPrinceton Fall 2026. Plan: `PLAN.md`. Agent rules: `CLAUDE.md`. API contracts and examples (synthetic data only): `contracts/`.

## Quick start
```bash
pip install -r requirements.txt
cp .env.example .env   # fill in keys from /costar-keys (never commit .env)
python -m engine.matterport demo-backup                           # fetch + cache (needs keys in .env)
python engine/fit.py --file data/cache/demo-backup.json            # cached demo unit
python engine/fit.py --file data/cache/demo-backup.json --hinges   # what-if: offset hinges
pytest -q
```

## Run the API (for the web app)
The API serves only local data: `data/cache/<sid>.json` (one file per fetched model) and `data/batch/index.json` (the ranked list). It never calls Matterport while serving.

```bash
# 1. data (once; needs keys in .env; about 25 min for the full Houston batch)
python -m engine.matterport demo-backup demo-pass redacted-unit-03   # demo units
python -m engine.batch                                            # units within 8 km of Texas Medical Center

# 2. server on http://localhost:8000 (CORS open for http://localhost:3000)
uvicorn agent.server:app --port 8000 --reload
```

| Request | Returns |
|---|---|
| `GET /api/units?lat=&lon=&radius_km=&beds=&w=&l=&hinges=` | Ranked list, same shape as `contracts/units_list.example.json`. All parameters are optional. `hinges=true` ranks by the offset-hinge scores. `w`/`l` must match the chair the batch used (27x42 in); other sizes get a 422. |
| `GET /api/units/{sid}?w=27&l=42&hinges=false` | Engine result for any chair size, same shape as `contracts/unit_result.example.json`. Returns 404 if the model is not cached. |
| `GET /api/health` | Number of cached models and batch progress. |
| `POST /api/chat?replay=1&pace=1` | SSE stream of a recorded agent run, with `event:` set to the type and `data:` holding the JSON event (`contracts/chat_events.example.jsonl`). Every event has `replay: true`; `pace` scales the delays (0 = instant). It uses `data/replay/run.jsonl` if present, otherwise the synthetic example. |
| `POST /api/chat` `{message, profile}` | Live agent run as an SSE stream. Returns 503 until a model is configured. |
| `POST /api/approve` `{action_id, approved}` | Approval gate. Nothing outbound is sent without it, and nothing is ever sent for a replayed run. Returns 404 for an unknown id and 409 if already decided. |

- If there is no batch index yet, `/api/units` returns 503.
- To serve data from another folder, set `ROLLIN_DATA_DIR=/path/to/data`.
- Without real data, the web app can build against the files in `contracts/`.

## The agent (live `/api/chat`)
`agent/agent.py` is a deepagents 0.7.38 orchestrator with four subagents (`search`, `geometry`, `verifier`, `outreach`) and five tools (`search_units`, `get_unit`, `run_fit`, `draft_landlord_message`, `send_message`).
- **Model:** `MODEL_PROVIDER` (`google` or `anthropic`) and `MODEL_NAME` from `.env`; we use `gemini-3.8-flash`. When these are set, the server attaches the agent to `POST /api/chat` automatically.
- **Approval:** `send_message` is held by the orchestrator only and is listed in `interrupt_on`. The run pauses and emits `approval_needed`, and continues only when `POST /api/approve` is called. Every outbound text starts by saying it comes from an AI. An approved message is queued in `data/outbox/` (gitignored) for the iMessage bridge; the agent itself delivers nothing.
- **Tracing:** LangSmith traces go to the `LANGSMITH_PROJECT` set in `.env`.
- **Try one run from the command line:**
  ```bash
  python -m agent.agent "27x42 in power chair, 1-2 bedrooms near the Texas Medical Center"
  ```
- **Replay:** `data/replay/run.jsonl` holds one recorded real run (gitignored, because it contains real data). `POST /api/chat?replay=1` streams it.

## Built with
Matterport Model API (wall graph, openings, rooms, panoramas), Vexcel aerial imagery, CoStar records, LangChain deepagents, LangChain, LangGraph, LangSmith, Google Gemini (gemini-3.8-flash via langchain-google-genai), Photon 2.0 (@photon-ai/api), NumPy, SciPy, Shapely, Pillow, Matplotlib, FastAPI, Uvicorn, HTTPX (tests), Requests, python-dotenv, pytest, Next.js, Tailwind, shadcn/ui, Radix, Motion, Lucide, socket.io-client, tsx; fonts Big Shoulders, Public Sans, IBM Plex Mono.

## What we built vs. what we used
(fill in before submission; disclose AI-assisted coding)
