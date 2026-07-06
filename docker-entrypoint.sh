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

# Rewrite health.json on every start so runtime env (compose overrides, recreated deployments)
# is always reflected. The build bakes dist/health.json with richer fallbacks (package.json
# version), so env values only win when set to something meaningful (non-empty, not "unknown");
# otherwise the baked build metadata is preserved.
base='{}'
if [ -s "$HTML/health.json" ] && jq -e . "$HTML/health.json" >/dev/null 2>&1; then
  base=$(cat "$HTML/health.json")
fi
write_json_atomic "$HTML/health.json" -n \
  --argjson base "$base" \
  --arg version "${APP_VERSION:-}" \
  --arg gitCommit "${GIT_COMMIT:-}" \
  --arg builtAt "${BUILD_TIME:-}" \
  '
  (if ($version != "" and $version != "unknown") then $version else ($base.version // "unknown") end) as $v
  | (if ($gitCommit != "" and $gitCommit != "unknown") then $gitCommit else ($base.gitCommit // "unknown") end) as $gc
  | (if $builtAt != "" then $builtAt else ($base.builtAt // (now | todate)) end) as $ba
  | {status:"ok", name:($base.name // "imwald"), version:$v, gitTag:("v" + $v), gitCommit:$gc, builtAt:$ba}
  '

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
