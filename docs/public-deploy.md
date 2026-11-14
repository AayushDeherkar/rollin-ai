# Public replay (Vercel)

The public site is fixture-only. It shows the synthetic contract apartment and the recorded synthetic run, under a standing "Replay with a synthetic apartment" label. It never calls the Rollin' API.

- **Switch:** `NEXT_PUBLIC_ROLLIN_PUBLIC=1` (`web/src/lib/public.ts`). With it on, `apiBase()` returns null even if `ROLLIN_API_URL` is set, so every route falls back to `contracts/*.example.json`. `/api/chat` replays `contracts/chat_events.example.jsonl`, and approvals for that run are never sent.
- **No keys or real data:** never set `ROLLIN_API_URL` or any key on the Vercel project. `web/scripts/deploy-public.sh` uploads only files tracked at HEAD (`git archive HEAD web contracts`), so `.env`, `data/` and `out/` cannot be included.
- **Checked before deploying:** a local `NEXT_PUBLIC_ROLLIN_PUBLIC=1 next build` contained none of the real ids or unit names from the local data.

## Deploy

1. Log in once: run `npx vercel login`.
2. Run `web/scripts/deploy-public.sh`.
3. First run only: the CLI sets up a project. Set its **Root Directory** to `web`; the web app imports `../contracts`, so the upload holds both folders. The project link is kept in `~/.config/rollin-public/.vercel`, outside the repo.
4. Later runs: re-run the script.

To check the public build locally:

```bash
cd web && env -u ROLLIN_API_URL NEXT_PUBLIC_ROLLIN_PUBLIC=1 npx next build && NEXT_PUBLIC_ROLLIN_PUBLIC=1 npx next start -p 3200
```
