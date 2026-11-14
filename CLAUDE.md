# CLAUDE.md — rules for every coding session in this repo

Project: **Rollin'** (HackPrinceton Fall 2026). Full plan: `PLAN.md` — read sections 4, 5, 7, 8, 9 before writing code.
Deadline: Sunday Nov 15, 8:00 AM ET. Feature freeze: Sunday 2:00 AM ET.

## Ownership (do not edit outside your owner's directories)
- Person A: `engine/`, `agent/`, `data/` scripts, `requirements.txt`
- Person B: `web/`, `messaging/`, `docs/devpost/`, `docs/peri/`, all `package.json` / lockfiles
- Shared (PR + tell the other person): `contracts/`, `README.md`, `PLAN.md`, `CLAUDE.md`, `.gitignore`
If your task needs a change in another area, stop and say so instead of making it.

## Git
- Work on a branch `a/<task>` or `b/<task>` in your own git worktree. Never commit to or force-push `main`.
- Small commits; `git fetch && git rebase origin/main` before pushing; squash-merge your own PRs.
- Only the owner edits lockfiles / dependency lists.

## Secrets
- Keys live only in `.env` (gitignored): `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`, `VEXCEL_API_KEY`, `COSTAR_ZIP_PASSWORD`, `COSTAR_KIT_URL`.
- Never print, log, commit, or hardcode them. Call the Matterport and Vexcel APIs from server-side code only.

## Data contract
- Engine output shape = `contracts/unit_result.example.json`. Do not change field names without a shared PR.
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
