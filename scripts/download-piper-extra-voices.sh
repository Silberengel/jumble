#!/usr/bin/env bash
# Download Piper ONNX voices from rhasspy/piper-voices into .local-piper-data (mounted as /data for piper-wyoming).
# Usage: bash scripts/download-piper-extra-voices.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/.local-piper-data"
HF="https://huggingface.co/rhasspy/piper-voices/resolve/main"

mkdir -p "$DEST"

fetch_pair() {
  local relpath="$1"
  local base_name
  base_name="$(basename "$relpath")"
  echo "Fetching ${base_name} ..."
  curl -fsSL -o "${DEST}/${base_name}.onnx" "${HF}/${relpath}.onnx"
  curl -fsSL -o "${DEST}/${base_name}.onnx.json" "${HF}/${relpath}.onnx.json"
}

# Paths match rhasspy/piper-voices `voices.json` and EXTRA_READ_ALOUD_PIPER_VOICE / server getVoiceForLanguage.
fetch_pair "ar/ar_JO/kareem/medium/ar_JO-kareem-medium"
fetch_pair "it/it_IT/paola/medium/it_IT-paola-medium"
fetch_pair "pt/pt_BR/cadu/medium/pt_BR-cadu-medium"

# Japanese: rhasspy/piper-voices has no ja_* ONNX; the app still uses Chinese Piper as a CJK-related read-aloud voice for `ja`.

echo "Done. Files are in ${DEST}. Restart piper-wyoming if it is already running."
