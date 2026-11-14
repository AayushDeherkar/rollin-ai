# Rollin' web

Next.js (App Router) + Tailwind v4 + shadcn/ui + Motion + Lucide. Owner: Person B.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

- Design rules: [DESIGN.md](DESIGN.md). All values: [tokens.css](tokens.css).
## Data

The browser calls this app's own `/api/units` and `/api/units/{sid}`; those route handlers
forward to the Rollin' API (`agent/server.py`) at `ROLLIN_API_URL`, server-side only.

```bash
cp .env.example .env.local      # ROLLIN_API_URL=http://localhost:8000
```

Run the API from the repo root (Python 3.11+, a venv outside the repo, real data only in gitignored folders):

```bash
python3 -m venv ../.venv-rollin && ../.venv-rollin/bin/pip install -r requirements.txt
ROLLIN_DATA_DIR=/path/to/data ../.venv-rollin/bin/uvicorn agent.server:app --port 8000
```

`ROLLIN_DATA_DIR` holds `cache/<sid>.json` (one per model) and, for the ranked list, `batch/index.json`.

If the API is unset, down, or has no answer for a fixture unit, the routes replay the synthetic
contract fixtures (`../contracts/*.example.json`) and the sheet says **Replay** on every panel that
shows them. `/?sid=<model id>` opens one unit by id even when it is not in the ranked list.

## Previews

- Preview panel states: `/?state=empty`, `/?state=loading`.
- Reduced motion without changing the OS setting: `/?motion=reduce` (Motion and the CSS duration tokens both follow it).
