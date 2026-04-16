#!/usr/bin/env bash
# One-shot host prep for editor stack sidecars:
#   1) LibreTranslate bind mount — dirs + ownership UID 1032 (official image user).
#   2) Piper ONNX voices — same set as scripts/download-piper-extra-voices.sh into:
#        - ./.local-piper-data (dev compose bind mount), and
#        - Docker volume <project>_piper-stack-data when it exists (docker-compose.prod.yml Wyoming /data).
#
# Run: bash scripts/ensure-libretranslate-dirs.sh   (or copy to repo root and ./ensure-libretranslate-dirs.sh)
#
# Optional env:
#   COMPOSE_PROJECT_NAME — Docker Compose project name (default: basename of repo dir), for volume jumble_piper-stack-data.
#   SKIP_PIPER_VOICES=1 — only fix LibreTranslate permissions, do not download Piper (~hundreds of MB).
set -euo pipefail
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [[ "$(basename "$_SCRIPT_DIR")" == "scripts" ]]; then
  ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
else
  ROOT="$_SCRIPT_DIR"
fi
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}"
PIPER_VOL="${PROJECT}_piper-stack-data"

echo "[ensure] LibreTranslate data dir (UID 1032) …"
mkdir -p "$ROOT/.local-libretranslate/share" "$ROOT/.local-libretranslate/cache"
docker run --rm \
  -v "$ROOT/.local-libretranslate:/d" \
  alpine:3.20 chown -R 1032:1032 /d

if [[ "${SKIP_PIPER_VOICES:-}" == "1" ]]; then
  echo "[ensure] SKIP_PIPER_VOICES=1 — skipping Piper voice download."
  exit 0
fi

echo "[ensure] Piper voices (bind mount .local-piper-data) …"
bash "$ROOT/scripts/download-piper-extra-voices.sh" "$ROOT/.local-piper-data"

if docker volume inspect "$PIPER_VOL" &>/dev/null; then
  echo "[ensure] Copying Piper voices into Docker volume ${PIPER_VOL} …"
  docker run --rm \
    -v "$PIPER_VOL:/data" \
    -v "$ROOT/.local-piper-data:/src:ro" \
    alpine:3.20 \
    sh -c 'set -e; for f in /src/*.onnx /src/*.onnx.json; do [ -f "$f" ] || continue; bn=$(basename "$f"); cp -a "$f" "/data/$bn"; done; ls -la /data | head -20'
else
  echo "[ensure] No Docker volume ${PIPER_VOL} (prod Wyoming uses it). Skipping volume copy — dev-only .local-piper-data is ready."
fi

echo "[ensure] Done."
