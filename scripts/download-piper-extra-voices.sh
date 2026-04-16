#!/usr/bin/env bash
# Download Piper ONNX voices — delegates to ensure-libretranslate-dirs.sh (single source of truth).
# Usage: bash scripts/download-piper-extra-voices.sh [DEST_DIR]
set -euo pipefail
__dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec bash "$__dir/ensure-libretranslate-dirs.sh" --download-piper-only "$@"
