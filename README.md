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

- If there is no batch index yet, `/api/units` returns 503.
- To serve data from another folder, set `ROLLIN_DATA_DIR=/path/to/data`.
- Without real data, the web app can build against the files in `contracts/`.

## Built with
Matterport Model API (wall graph, openings, rooms, panoramas), Vexcel aerial imagery, CoStar records, LangChain deepagents, Photon Spectrum, NumPy, SciPy, Shapely, Pillow, Matplotlib, FastAPI, Uvicorn, HTTPX (tests), Requests, python-dotenv, pytest, Next.js, Tailwind, shadcn/ui.

## What we built vs. what we used
(fill in before submission; disclose AI-assisted coding)
