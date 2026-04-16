#!/usr/bin/env bash
# One-shot host prep for editor stack sidecars:
#   1) LibreTranslate bind mount — dirs + ownership UID 1032 (official image user).
#   2) Piper ONNX voices — trinity + read-aloud extras (rhasspy/piper-voices) into:
#        - ./.local-piper-data (dev compose bind mount), and
#        - Docker volume <project>_piper-stack-data when it exists (docker-compose.prod.yml Wyoming /data).
#
# Piper download logic lives in this file so you can copy **only** this script to a server and run it
# from the repo root (still need curl, docker; full clone is easier: bash scripts/ensure-libretranslate-dirs.sh).
#
# Internal entry: bash ensure-libretranslate-dirs.sh --download-piper-only [DEST]
#   (used by scripts/download-piper-extra-voices.sh — keep voice list in sync with trinity-languages.ts)
#
# Optional env:
#   COMPOSE_PROJECT_NAME — Docker Compose project name (default: basename of repo dir), for volume *_piper-stack-data.
#   SKIP_PIPER_VOICES=1 — only fix LibreTranslate permissions, do not download Piper.
#   HF_BASE — Hugging Face resolve base for Piper ONNX (default rhasspy/piper-voices/main).
set -euo pipefail

_resolve_root() {
  _SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
  if [[ "$(basename "$_SCRIPT_DIR")" == "scripts" ]]; then
    ROOT="$(cd "$_SCRIPT_DIR/.." && pwd)"
  else
    ROOT="$_SCRIPT_DIR"
  fi
}

# Keep in sync with src/lib/trinity-languages.ts (TRINITY_PIPER_VOICE + EXTRA_READ_ALOUD_PIPER_VOICE) and server voiceMap.
download_piper_voices_to() {
  local dest="${1:?destination directory}"
  local hf="${HF_BASE:-https://huggingface.co/rhasspy/piper-voices/resolve/main}"
  mkdir -p "$dest"
  local relpath base_name onnx json
  for relpath in \
    "en/en_US/lessac/medium/en_US-lessac-medium" \
    "de/de_DE/thorsten/medium/de_DE-thorsten-medium" \
    "fr/fr_FR/siwis/medium/fr_FR-siwis-medium" \
    "es/es_ES/davefx/medium/es_ES-davefx-medium" \
    "ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium" \
    "zh/zh_CN/huayan/medium/zh_CN-huayan-medium" \
    "pl/pl_PL/darkman/medium/pl_PL-darkman-medium" \
    "nl/nl_NL/mls/medium/nl_NL-mls-medium" \
    "cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium" \
    "tr/tr_TR/dfki/medium/tr_TR-dfki-medium" \
    "ar/ar_JO/kareem/medium/ar_JO-kareem-medium" \
    "it/it_IT/paola/medium/it_IT-paola-medium" \
    "pt/pt_BR/cadu/medium/pt_BR-cadu-medium"
  do
    base_name="$(basename "$relpath")"
    onnx="${dest}/${base_name}.onnx"
    json="${dest}/${base_name}.onnx.json"
    if [[ -f "$onnx" && -f "$json" ]]; then
      echo "Skip (exists): ${base_name}"
      continue
    fi
    echo "Fetching ${base_name} …"
    curl -fsSL -o "$onnx" "${hf}/${relpath}.onnx"
    curl -fsSL -o "$json" "${hf}/${relpath}.onnx.json"
  done
  echo "Piper ONNX done → ${dest}"
}

if [[ "${1:-}" == "--download-piper-only" ]]; then
  shift
  _resolve_root
  download_piper_voices_to "${1:-${PIPER_DOWNLOAD_DIR:-$ROOT/.local-piper-data}}"
  exit 0
fi

_resolve_root
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
download_piper_voices_to "$ROOT/.local-piper-data"

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
