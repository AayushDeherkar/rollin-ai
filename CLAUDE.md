# CLAUDE.md — rules for every coding session in this repo

Project: **Rollin'** (HackPrinceton Fall 2026). Full plan: `PLAN.md` — read sections 4, 5, 7, 8, 9 before writing code.
Deadline: Sunday Nov 15, 8:00 AM ET. Feature freeze: Sunday 2:00 AM ET.

## Ownership (do not edit outside your owner's paths)
- Person A = **Aayush** (engine, agent, data, Python): `engine/`, `agent/`, `data/`, `tests/`, `requirements.txt`, `contracts/`, `README.md`, `PLAN.md`, `CLAUDE.md`, `.gitignore`, `.env.example`
- Person B = **Aarohi** (web, messaging, TypeScript): `web/`, `messaging/`, `docs/` (including all `package.json` / lockfiles inside them). Aarohi edits nothing else; she requests changes to shared files (`contracts/`, `README.md`, `PLAN.md`, `CLAUDE.md`) through the manager.
- Before every merge: `git diff --name-only origin/main...HEAD` must list only paths you own.
If your task needs a change in another area, stop and say so instead of making it.

## Git
- Work on a branch `a/<task>` or `b/<task>` in your own git worktree. Never commit to or force-push `main`.
- Small commits; `git fetch && git rebase origin/main` before pushing; squash-merge your own PRs.
- Only the owner edits lockfiles / dependency lists.

## Secrets
- Keys live only in `.env` (gitignored); names are listed in `.env.example` (Matterport, Vexcel, CoStar, LangSmith, model provider).
- Never print, log, commit, or hardcode them. Call the Matterport and Vexcel APIs from server-side code only.
- ChatOverflow notes must never include keys, addresses, model ids, or any CoStar/Matterport/Vexcel data.

## Data contract
- Engine output shape = `contracts/unit_result.example.json`. Do not change field names without a shared PR.
- Contract examples are generated from synthetic apartments only: `python contracts/make_examples.py` (see `contracts/README.md`).
- Real data lives only in gitignored `data/cache/`, `data/raw/`, `data/batch/`, `out/`.
- Matterport: split queries (walls+doors / rooms / dimensions), retry `error.internal` up to 4×, cache to `data/cache/<sid>.json`.
- Ignore opening `height`/`lowerElevation`. Openings < 18 in are artifacts. Rooms labelled `Void` are skipped.
- Coordinates: metres, model frame. Showcase SDK frame: `api_to_sdk(x, y, z) = (x, z, -y)`.

## Honesty rules (these protect us from disqualification)
- Never invent data, statistics, door widths, or results. Unknown stays "unknown".
- Label estimates in UI and API (`clear_in_est`, "walls only", "from aerial").
- Any cached/replayed run shown in the demo must be labelled as such.
- The agent never sends a message or contacts anyone without an explicit approval step, and identifies itself as an AI.
- Credit every library in the README.

## Style
- Python 3.11, type hints, small functions, `pytest` for engine changes (validate output keys against the contract example).
- Web: Next.js App Router, Tailwind, shadcn/ui, Motion. Projector-first: ≥16 px body text, high contrast, one accent colour.
- Plan before writing more than ~50 lines; one task per session.
