#!/usr/bin/env bash
# Download Piper ONNX voices from rhasspy/piper-voices (trinity read-aloud + extras).
# Usage: bash scripts/download-piper-extra-voices.sh [DEST_DIR]
#   DEST_DIR defaults to repo/.local-piper-data (Wyoming --data-dir in docker-compose.dev.yml).
# Env: HF_BASE — override Hugging Face resolve base (default rhasspy/piper-voices/main).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-${PIPER_DOWNLOAD_DIR:-$ROOT/.local-piper-data}}"
HF="${HF_BASE:-https://huggingface.co/rhasspy/piper-voices/resolve/main}"

mkdir -p "$DEST"

fetch_pair() {
  local relpath="$1"
  local base_name
  base_name="$(basename "$relpath")"
  local onnx="${DEST}/${base_name}.onnx"
  local json="${DEST}/${base_name}.onnx.json"
  if [[ -f "$onnx" && -f "$json" ]]; then
    echo "Skip (exists): ${base_name}"
    return 0
  fi
  echo "Fetching ${base_name} ..."
  curl -fsSL -o "$onnx" "${HF}/${relpath}.onnx"
  curl -fsSL -o "$json" "${HF}/${relpath}.onnx.json"
}

# --- Trinity UI locales (keep in sync with src/lib/trinity-languages.ts TRINITY_PIPER_VOICE) ---
fetch_pair "en/en_US/lessac/medium/en_US-lessac-medium"
fetch_pair "de/de_DE/thorsten/medium/de_DE-thorsten-medium"
fetch_pair "fr/fr_FR/siwis/medium/fr_FR-siwis-medium"
fetch_pair "es/es_ES/davefx/medium/es_ES-davefx-medium"
fetch_pair "ru/ru_RU/ruslan/medium/ru_RU-ruslan-medium"
fetch_pair "zh/zh_CN/huayan/medium/zh_CN-huayan-medium"
fetch_pair "pl/pl_PL/darkman/medium/pl_PL-darkman-medium"
fetch_pair "nl/nl_NL/mls/medium/nl_NL-mls-medium"
fetch_pair "cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium"
fetch_pair "tr/tr_TR/dfki/medium/tr_TR-dfki-medium"

# --- Read-aloud extras (EXTRA_READ_ALOUD_PIPER_VOICE + server voiceMap) ---
fetch_pair "ar/ar_JO/kareem/medium/ar_JO-kareem-medium"
fetch_pair "it/it_IT/paola/medium/it_IT-paola-medium"
fetch_pair "pt/pt_BR/cadu/medium/pt_BR-cadu-medium"

# Japanese: no ja_* in rhasspy/piper-voices; app uses Chinese Piper for ja-related read-aloud.

echo "Done. Piper files in ${DEST}. Restart piper-wyoming if it is already running."
