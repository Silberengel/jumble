#!/usr/bin/env bash
# One-shot host prep for editor stack sidecars:
#   1) LibreTranslate bind mount — dirs + ownership UID 1032 (official image user).
#   2) Recommended Argos / LT_LOAD_ONLY list — written beside the volume (see below).
#   3) Piper ONNX voices — same set as src/lib/trinity-languages.ts + piper-tts-proxy voiceMap
#        into ./.local-piper-data and optionally Docker volume <project>_piper-stack-data.
#
# Argos translation models are pulled by the LibreTranslate **container** from LT_LOAD_ONLY on first
# start (bind mount .local-libretranslate). Default list: scripts/libretranslate-lt.default.env (same file
# as docker-compose `env_file` for libretranslate).
#
# Piper download logic lives in this file so you can copy **only** this script to a server and run it
# from the repo root (still need curl, docker). If `scripts/libretranslate-lt.default.env` is missing,
# a built-in LT_LOAD_ONLY list is used (see load_stack_lt_load_only). Full clone is easiest:
#   bash scripts/ensure-libretranslate-dirs.sh
#
# Internal entry: bash ensure-libretranslate-dirs.sh --download-piper-only [DEST]
#   (used by scripts/download-piper-extra-voices.sh — keep Piper relpaths in sync with trinity-languages.ts)
#
# Optional env:
#   COMPOSE_PROJECT_NAME — Docker Compose project name (default: basename of repo dir), for volume *_piper-stack-data.
#   SKIP_PIPER_VOICES=1 — only fix LibreTranslate permissions (+ LT_LOAD_ONLY hint file), do not download Piper.
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

# Keep identical to scripts/libretranslate-lt.default.env in the repo (fallback when that file is absent).
DEFAULT_LT_LOAD_ONLY='en,de,es,fr,it,pt,ru,zh,ar,nl,pl,cs,tr'

load_stack_lt_load_only() {
  local f="${ROOT}/scripts/libretranslate-lt.default.env"
  local f_alt="${ROOT}/libretranslate-lt.default.env"
  if [[ -f "$f" ]]; then
    STACK_LT_LOAD_ONLY="$(grep -E '^[[:space:]]*LT_LOAD_ONLY=' "$f" | head -1 | sed 's/^[[:space:]]*LT_LOAD_ONLY=//')"
  elif [[ -f "$f_alt" ]]; then
    STACK_LT_LOAD_ONLY="$(grep -E '^[[:space:]]*LT_LOAD_ONLY=' "$f_alt" | head -1 | sed 's/^[[:space:]]*LT_LOAD_ONLY=//')"
  else
    echo "[ensure] warn: missing ${f} (and ${f_alt}) — using built-in LT_LOAD_ONLY. Copy scripts/libretranslate-lt.default.env from the repo to customize." >&2
    STACK_LT_LOAD_ONLY="$DEFAULT_LT_LOAD_ONLY"
  fi
  [[ -n "$STACK_LT_LOAD_ONLY" ]] || {
    echo "[ensure] LT_LOAD_ONLY empty (check ${f} or set LT_LOAD_ONLY before running)" >&2
    exit 1
  }
}

# Keep in sync with src/lib/trinity-languages.ts (TRINITY_PIPER_VOICE + EXTRA_READ_ALOUD_PIPER_VOICE)
# and services/piper-tts-proxy/server.ts getVoiceForLanguage voiceMap (14 voices: 10 trinity + en-gb, ar, it, pt).
download_piper_voices_to() {
  local dest="${1:?destination directory}"
  local hf="${HF_BASE:-https://huggingface.co/rhasspy/piper-voices/resolve/main}"
  mkdir -p "$dest"
  local relpath base_name onnx json
  for relpath in \
    "en/en_US/lessac/medium/en_US-lessac-medium" \
    "en/en_GB/alan/medium/en_GB-alan-medium" \
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
    # HuggingFace can be slow or reset mid-transfer; retries + caps avoid hung deploys.
    curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 600 \
      -o "$onnx" "${hf}/${relpath}.onnx"
    curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 600 \
      -o "$json" "${hf}/${relpath}.onnx.json"
  done
  echo "Piper ONNX done → ${dest}"
}

write_lt_load_only_hint() {
  local lt_dir="${1:?libretranslate data dir}"
  local hint="${lt_dir}/.recommended-lt-load-only.txt"
  docker run --rm \
    -e STACK_LT_LOAD_ONLY="$STACK_LT_LOAD_ONLY" \
    -v "$lt_dir:/d" \
    alpine:3.20 \
    sh -c 'printf "%s\n" "$STACK_LT_LOAD_ONLY" > /d/.recommended-lt-load-only.txt && chown 1032:1032 /d/.recommended-lt-load-only.txt'
  echo "[ensure] Recommended LibreTranslate LT_LOAD_ONLY (Argos) → ${hint}"
  echo "         Keep in sync with scripts/libretranslate-lt.default.env (compose env_file). Recreate libretranslate once (LT_UPDATE_MODELS=true) after changing the list."
}

if [[ "${1:-}" == "--download-piper-only" ]]; then
  shift
  _resolve_root
  download_piper_voices_to "${1:-${PIPER_DOWNLOAD_DIR:-$ROOT/.local-piper-data}}"
  exit 0
fi

_resolve_root
load_stack_lt_load_only
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT")}"
PIPER_VOL="${PROJECT}_piper-stack-data"

echo "[ensure] LibreTranslate data dir (UID 1032) …"
if [[ -e "$ROOT/.local-libretranslate" ]] && [[ ! -w "$ROOT/.local-libretranslate" ]]; then
  echo "[ensure] Resetting bind-mount ownership so the host can create dirs (final step sets UID 1032) …"
  docker run --rm \
    -v "$ROOT/.local-libretranslate:/d" \
    alpine:3.20 chown -R "$(id -u):$(id -g)" /d
fi
mkdir -p "$ROOT/.local-libretranslate/share" "$ROOT/.local-libretranslate/cache"

write_lt_load_only_hint "$ROOT/.local-libretranslate"

docker run --rm \
  -v "$ROOT/.local-libretranslate:/d" \
  alpine:3.20 chown -R 1032:1032 /d

if [[ "${SKIP_PIPER_VOICES:-}" == "1" ]]; then
  echo "[ensure] SKIP_PIPER_VOICES=1 — skipping Piper voice download."
  echo "[ensure] Stack languages: translate=${STACK_LT_LOAD_ONLY} (LibreTranslate); grammar=LanguageTool; read-aloud=Piper in .local-piper-data (run again without SKIP to fetch)."
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
echo "[ensure] Summary — translate: LT_LOAD_ONLY=${STACK_LT_LOAD_ONLY} in Compose; grammar: LanguageTool; read-aloud: Piper ONNX above (+ Wyoming)."
