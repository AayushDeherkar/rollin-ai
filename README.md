# Rollin'

Your wheelchair just test-drove 200 Houston apartments. Rollin' finds the ones you can actually live in, shows exactly which door stops you, and asks the landlord about the rest.

Built at HackPrinceton Fall 2026. Plan: `PLAN.md`. Agent rules: `CLAUDE.md`. API contracts and examples (synthetic data only): `contracts/`.

## Quick start
```bash
pip install -r requirements.txt
cp .env.example .env   # fill in keys from /costar-keys (never commit .env)
python engine/fit.py --file data/cache/demo-backup.json            # cached demo unit
python engine/fit.py --file data/cache/demo-backup.json --hinges   # what-if: offset hinges
pytest -q
```

## Built with
Matterport Model API (wall graph, openings, rooms, panoramas), Vexcel aerial imagery, CoStar records, LangChain deepagents, Photon Spectrum, NumPy, SciPy, Shapely, Pillow, Matplotlib, FastAPI, Next.js, Tailwind, shadcn/ui.

## What we built vs. what we used
(fill in before submission; disclose AI-assisted coding)
