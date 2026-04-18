#!/usr/bin/env bash
# Drop Argos packages / MiniSBD files not in LT_LOAD_ONLY (default: scripts/libretranslate-lt.default.env).
# Stops LibreTranslate briefly so files are not in use; uses Docker+Alpine to delete UID-1032-owned trees.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARGOS="$ROOT/.local-libretranslate/share/argos-translate"
LT_DEFAULT_ENV="$ROOT/scripts/libretranslate-lt.default.env"
if [[ -z "${LT_LOAD_ONLY:-}" ]]; then
  LT_LOAD_ONLY="$(grep -E '^[[:space:]]*LT_LOAD_ONLY=' "$LT_DEFAULT_ENV" | head -1 | sed 's/^[[:space:]]*LT_LOAD_ONLY=//')"
fi

if [[ ! -d "$ARGOS/packages" ]]; then
  echo "Nothing to prune (missing $ARGOS/packages)." >&2
  exit 0
fi

running=""
for n in jumble-libretranslate imwald-libretranslate; do
  if docker inspect -f '{{.State.Running}}' "$n" &>/dev/null; then
    if [[ $(docker inspect -f '{{.State.Running}}' "$n") == "true" ]]; then
      running="$n"
      break
    fi
  fi
done

if [[ -n "$running" ]]; then
  echo "Stopping $running ..."
  docker stop "$running" >/dev/null
fi

docker run --rm \
  -e LT_LOAD_ONLY="$LT_LOAD_ONLY" \
  -e ARGOS_ROOT=/argos \
  -v "$ARGOS:/argos:rw" \
  -v "$ROOT/scripts/prune-libretranslate-packages.py:/prune.py:ro" \
  alpine:3.20 \
  sh -ec 'apk add --no-cache python3 >/dev/null && python3 /prune.py'

if [[ -n "$running" ]]; then
  echo "Starting $running ..."
  docker start "$running" >/dev/null
fi
