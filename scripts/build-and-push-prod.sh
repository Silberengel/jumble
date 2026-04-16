#!/usr/bin/env bash
# Build and push first-party production images (same tags :latest and :<version from package.json>):
#   - silberengel/imwald-jumble (SPA)
#   - silberengel/imwald-jumble-nip66-monitor
#   - silberengel/imwald-piper-tts-proxy (HTTP → Wyoming Piper; matches docker-compose.prod.yml)
# Then create git tag v<version> and push it.
# Other compose services (og-proxy, wyoming-piper, LanguageTool, LibreTranslate) pull from Hub on the server.
# Run from repo root. Requires: docker, docker login, git.
#
# Optional env:
#   IMWALD_PROXY_SERVER_URL — build-arg VITE_PROXY_SERVER (default https://jumble.imwald.eu).
#     Alias: JUMBLE_PROXY_SERVER_URL (deprecated). Must match the public origin where Apache serves the app.
#   READ_ALOUD_TTS_URL — build-arg VITE_READ_ALOUD_TTS_URL (default /api/piper-tts).
#     Same-origin: Apache proxies /api/piper-tts → aitherboard (e.g. :9876). Override only if you use CORS on another host.
#   LANGUAGE_TOOL_URL — build-arg VITE_LANGUAGE_TOOL_URL (default empty). Example: /api/languagetool with Apache → LanguageTool :8010.
#   TRANSLATE_URL — build-arg VITE_TRANSLATE_URL (default empty). Example: /api/translate with Apache → LibreTranslate :5000.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -p "require('./package.json').version")"
GIT_TAG="v${VERSION}"
IMAGE_APP="silberengel/imwald-jumble"
IMAGE_MONITOR="silberengel/imwald-jumble-nip66-monitor"
IMAGE_PIPER_PROXY="silberengel/imwald-piper-tts-proxy"

# OG / link-preview HTML: VITE_PROXY_SERVER is baked into the client bundle at image build time (not runtime).
# Use public origin only (no /proxy path): web.service builds <origin>/sites/?url=…
# Override: IMWALD_PROXY_SERVER_URL=https://other.example ./scripts/build-and-push-prod.sh
PROXY_ORIGIN="${IMWALD_PROXY_SERVER_URL:-${JUMBLE_PROXY_SERVER_URL:-https://jumble.imwald.eu}}"
READ_ALOUD_TTS_URL="${READ_ALOUD_TTS_URL:-/api/piper-tts}"
LANGUAGE_TOOL_URL="${LANGUAGE_TOOL_URL:-}"
TRANSLATE_URL="${TRANSLATE_URL:-}"

echo "Building main app (version: $VERSION, VITE_PROXY_SERVER=$PROXY_ORIGIN, VITE_READ_ALOUD_TTS_URL=$READ_ALOUD_TTS_URL, VITE_LANGUAGE_TOOL_URL=$LANGUAGE_TOOL_URL, VITE_TRANSLATE_URL=$TRANSLATE_URL)"
docker build \
  --build-arg "VITE_PROXY_SERVER=$PROXY_ORIGIN" \
  --build-arg "VITE_READ_ALOUD_TTS_URL=$READ_ALOUD_TTS_URL" \
  --build-arg "VITE_LANGUAGE_TOOL_URL=$LANGUAGE_TOOL_URL" \
  --build-arg "VITE_TRANSLATE_URL=$TRANSLATE_URL" \
  -t "$IMAGE_APP:latest" -t "$IMAGE_APP:$VERSION" .

echo "Building NIP-66 monitor (version: $VERSION)"
docker build -t "$IMAGE_MONITOR:latest" -t "$IMAGE_MONITOR:$VERSION" ./nip66-cron

echo "Building Piper HTTP TTS proxy (version: $VERSION)"
docker build \
  -f services/piper-tts-proxy/Dockerfile \
  -t "$IMAGE_PIPER_PROXY:latest" -t "$IMAGE_PIPER_PROXY:$VERSION" .

echo "Pushing $IMAGE_APP, $IMAGE_MONITOR, and $IMAGE_PIPER_PROXY"
docker push "$IMAGE_APP:latest"
docker push "$IMAGE_APP:$VERSION"
docker push "$IMAGE_MONITOR:latest"
docker push "$IMAGE_MONITOR:$VERSION"
docker push "$IMAGE_PIPER_PROXY:latest"
docker push "$IMAGE_PIPER_PROXY:$VERSION"

# --- Git tag (matches package.json version) ---
if git rev-parse "$GIT_TAG" >/dev/null 2>&1; then
  echo "Tag $GIT_TAG already exists locally. Bump version in package.json or delete the tag." >&2
  exit 1
fi

if git ls-remote origin "refs/tags/$GIT_TAG" | grep -q .; then
  echo "Tag $GIT_TAG already exists on origin. Bump version in package.json or delete the remote tag." >&2
  exit 1
fi

echo "Creating annotated tag $GIT_TAG at HEAD"
git tag -a "$GIT_TAG" -m "Release $GIT_TAG"

echo "Pushing tag $GIT_TAG to origin"
git push origin "$GIT_TAG"

echo "Done. On the server (repo clone): bash scripts/ensure-libretranslate-dirs.sh   # once, for LibreTranslate volume permissions"
echo "  docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d"
