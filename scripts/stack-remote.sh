#!/usr/bin/env bash
# One remote command from repo clone: full docker-compose.prod.yml stack (pull + up).
# Same as: ensure-libretranslate-dirs.sh && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
# First-party images must be pushed from ./scripts/build-and-push-prod.sh before pull will get new app/monitor/piper-proxy revisions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/ensure-libretranslate-dirs.sh"
COMPOSE=(docker compose -f docker-compose.prod.yml)
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d
echo "[stack:remote] jumble :8089 | og-proxy :8090 | piper HTTP :9876 | LT :8010 | translate :5000"
