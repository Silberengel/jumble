#!/usr/bin/env bash
# One remote command from repo clone: silberengel/imwald-jumble + nip66 + wikistr og-proxy + wyoming-piper +
# imwald-piper-tts-proxy (built here; push silberengel/imwald-piper-tts-proxy:latest to Hub for pull-only hosts) +
# LanguageTool + LibreTranslate. Apache → 8089 / 8090 / 9876.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/ensure-libretranslate-dirs.sh"
COMPOSE=(docker compose -f docker-compose.prod.yml --profile stack --profile editor-tools)
# Pull Hub images only; piper-tts-proxy is built from this repo (push silberengel/imwald-piper-tts-proxy:latest when ready).
"${COMPOSE[@]}" pull jumble jumble-nip66-monitor og-proxy piper-wyoming languagetool libretranslate
"${COMPOSE[@]}" build piper-tts-proxy
"${COMPOSE[@]}" up -d
echo "[stack:remote] jumble :8089 | og-proxy :8090 | piper HTTP :9876 | LT :8010 | translate :5000"
