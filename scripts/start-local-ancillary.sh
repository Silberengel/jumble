#!/usr/bin/env bash
# Start LanguageTool, LibreTranslate, Wyoming Piper, and the Piper HTTP proxy (Docker).
# Run the app separately: npm run dev
# Optional .env.local (Vite): VITE_READ_ALOUD_TTS_URL=/api/piper-tts VITE_LANGUAGE_TOOL_URL=/api/languagetool VITE_TRANSLATE_URL=/api/translate
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local-piper-data
npm run docker:local-ancillary
echo
echo "Ancillary stack is up (LanguageTool :8010, LibreTranslate :5000, Piper proxy :9876)."
echo "Wyoming Piper listens inside Docker only; the HTTP proxy on 127.0.0.1:9876 forwards to it."
echo "Next: npm run dev"
