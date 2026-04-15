#!/usr/bin/env bash
# One local command: Docker backends + Vite (Ctrl+C stops Vite; Docker keeps running).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export OG_PROXY_ALLOW_ORIGIN="${OG_PROXY_ALLOW_ORIGIN:-http://localhost:5173}"
mkdir -p .local-piper-data
bash "$ROOT/scripts/ensure-libretranslate-dirs.sh"
docker compose -f docker-compose.dev.yml --profile editor-tools --profile local-tts build piper-tts-proxy
docker compose -f docker-compose.dev.yml --profile editor-tools --profile local-tts up -d \
  og-proxy languagetool libretranslate piper-wyoming piper-tts-proxy
echo "[dev:all] Jumble=Vite (.env.development → /sites, /api/piper-tts, lab APIs) | og-proxy :8090 | Piper :9876"
exec npm run dev
