#!/usr/bin/env bash
# Start a local ORLY Nostr relay for Jumble dev/testing (sibling repo ../next.orly.dev).
# Default: ws://127.0.0.1:4869/ — add that URL as a cache relay in settings.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORLY_ROOT="${ORLY_ROOT:-$ROOT/../next.orly.dev}"
export ORLY_PORT="${ORLY_PORT:-4869}"
export ORLY_ACL_MODE="${ORLY_ACL_MODE:-none}"
export ORLY_DATA_DIR="${ORLY_DATA_DIR:-${TMPDIR:-/tmp}/orly-jumble-relay-$ORLY_PORT}"
mkdir -p "$ORLY_DATA_DIR"
if [[ ! -d "$ORLY_ROOT/cmd/orly" ]]; then
  echo "ORLY repo not found at: $ORLY_ROOT" >&2
  echo "Set ORLY_ROOT to your next.orly.dev checkout." >&2
  exit 1
fi
echo "Orly: ws://127.0.0.1:${ORLY_PORT}/ (ORLY_DATA_DIR=$ORLY_DATA_DIR)"
cd "$ORLY_ROOT"
exec go run ./cmd/orly
