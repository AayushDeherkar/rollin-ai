#!/usr/bin/env bash
# Deploy the fixture-only public replay to Vercel (see docs/public-deploy.md).
# Uploads only files tracked at HEAD (git archive), so nothing gitignored (.env, data/, out/)
# can reach the deployment; from data/ only the tracked, sourced chair presets go. The build runs with NEXT_PUBLIC_ROLLIN_PUBLIC=1 and no ROLLIN_API_URL.
set -euo pipefail
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
git -C "$repo" archive HEAD web contracts data/chair_presets.json | tar -x -C "$out"
# the Vercel project link is kept outside the repo, so no checkout ever holds it
link="${ROLLIN_VERCEL_LINK:-$HOME/.config/rollin-public/.vercel}"
cd "$out"
if [ -d "$link" ]; then
  cp -R "$link" "$out/.vercel"
else
  # first run: link interactively (no --yes), so the project's code directory can be set to `web`;
  # with defaults the root would be ./, where there is no app, and the site would serve raw files
  echo "No Vercel project link yet. Link one now; when asked which directory your code is in, answer: web"
  npx --yes vercel@latest link
  mkdir -p "$(dirname "$link")" && cp -R "$out/.vercel" "$link"
fi
npx --yes vercel@latest deploy --prod --yes \
  --build-env NEXT_PUBLIC_ROLLIN_PUBLIC=1 \
  --env NEXT_PUBLIC_ROLLIN_PUBLIC=1 "$@"
