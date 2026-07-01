#!/bin/sh
# Runtime config for the SPA. NIP-66 monitor runs in a separate cron container; nsec is never sent to the client.
# Optional: NIP66_MONITOR_NPUB (npub of the monitor) can be exposed so the relay info page shows who runs the monitor.
set -e

HTML=/usr/share/nginx/html

if ! command -v jq >/dev/null 2>&1; then
  echo "docker-entrypoint: jq is required but not installed" >&2
  exit 1
fi

# Write JSON atomically so a failed jq run cannot truncate the destination file.
write_json_atomic() {
  dest=$1
  shift
  tmp="${dest}.tmp.$$"
  if ! jq "$@" > "$tmp"; then
    rm -f "$tmp"
    echo "docker-entrypoint: jq failed writing ${dest}" >&2
    exit 1
  fi
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    echo "docker-entrypoint: jq produced empty output for ${dest}" >&2
    exit 1
  fi
  mv "$tmp" "$dest"
}

if [ ! -s "$HTML/health.json" ]; then
  version="${APP_VERSION:-unknown}"
  git_commit="${GIT_COMMIT:-unknown}"
  built_at="${BUILD_TIME:-$(date -Iseconds)}"
  write_json_atomic "$HTML/health.json" -n \
    --arg version "$version" \
    --arg gitTag "v${version}" \
    --arg gitCommit "$git_commit" \
    --arg builtAt "$built_at" \
    '{status:"ok", name:"imwald", version:$version, gitTag:$gitTag, gitCommit:$gitCommit, builtAt:$builtAt}'
fi

if [ -n "$NIP66_MONITOR_NPUB" ]; then
  write_json_atomic "$HTML/config.json" -n \
    --arg npub "$NIP66_MONITOR_NPUB" \
    '{NIP66_MONITOR_NPUB: $npub}'
else
  tmp="${HTML}/config.json.tmp.$$"
  if ! printf '%s\n' '{}' > "$tmp"; then
    rm -f "$tmp"
    echo "docker-entrypoint: failed writing ${HTML}/config.json" >&2
    exit 1
  fi
  mv "$tmp" "$HTML/config.json"
fi

exec nginx -g "daemon off;"
