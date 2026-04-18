#!/usr/bin/env bash
# Download Piper ONNX voices (read-aloud / Wyoming) — delegates to ensure-libretranslate-dirs.sh.
# Does not touch LibreTranslate dirs, Docker, or scripts/libretranslate-lt.default.env.
#
# Usage:
#   bash scripts/download-piper-extra-voices.sh [DEST_DIR]
# Default DEST: $PIPER_DOWNLOAD_DIR if set, else <repo>/.local-piper-data
# Optional: HF_BASE (see ensure-libretranslate-dirs.sh) for a Hugging Face mirror.
#
# Voice list lives only in ensure-libretranslate-dirs.sh (download_piper_voices_to).
set -euo pipefail
__dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_ensure="${__dir}/ensure-libretranslate-dirs.sh"
[[ -f "$_ensure" ]] || {
  echo "[download-piper-extra-voices] Missing ${_ensure} (keep this script next to ensure-libretranslate-dirs.sh)." >&2
  exit 1
}
exec bash "$_ensure" --download-piper-only "$@"
