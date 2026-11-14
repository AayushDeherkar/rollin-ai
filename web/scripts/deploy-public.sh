#!/usr/bin/env bash
# Deploy the fixture-only public replay to Vercel (see docs/public-deploy.md).
# Uploads only files tracked at HEAD (git archive), so nothing gitignored (.env, data/, out/)
# can reach the deployment. The build runs with NEXT_PUBLIC_ROLLIN_PUBLIC=1 and no ROLLIN_API_URL.
set -euo pipefail
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
git -C "$repo" archive HEAD web contracts | tar -x -C "$out"
# the Vercel project link is kept outside the repo (.vercel is not gitignored here)
link="${ROLLIN_VERCEL_LINK:-$HOME/.config/rollin-public/.vercel}"
if [ -d "$link" ]; then cp -R "$link" "$out/.vercel"; fi
cd "$out"
npx --yes vercel@latest deploy --prod --yes \
  --build-env NEXT_PUBLIC_ROLLIN_PUBLIC=1 \
  --env NEXT_PUBLIC_ROLLIN_PUBLIC=1 "$@"
if [ -d "$out/.vercel" ] && [ ! -d "$link" ]; then mkdir -p "$(dirname "$link")" && cp -R "$out/.vercel" "$link"; fi
