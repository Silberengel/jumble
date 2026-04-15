#!/usr/bin/env bash
# Host dirs for LibreTranslate bind mounts must be writable by container UID 1032 (see docker-compose*.yml).
# Uses a one-shot Alpine container so you do not need sudo chown on the host.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.local-libretranslate/share" "$ROOT/.local-libretranslate/cache"
docker run --rm \
  -v "$ROOT/.local-libretranslate/share:/s" \
  -v "$ROOT/.local-libretranslate/cache:/c" \
  alpine:3.20 chown -R 1032:1032 /s /c
