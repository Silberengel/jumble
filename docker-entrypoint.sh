#!/bin/sh
# Runtime config for the SPA. NIP-66 monitor runs in a separate cron container; nsec is never sent to the client.
# Optional: NIP66_MONITOR_NPUB (npub of the monitor) can be exposed so the relay info page shows who runs the monitor.
HTML=/usr/share/nginx/html
if [ ! -s "$HTML/health.json" ]; then
  jq -n --arg t "$(date -Iseconds)" \
    '{status:"ok", name:"imwald", version:"unknown", gitTag:"unknown", gitCommit:"unknown", builtAt:$t}' \
    > "$HTML/health.json"
fi
if [ -n "$NIP66_MONITOR_NPUB" ]; then
  jq -n --arg npub "$NIP66_MONITOR_NPUB" '{NIP66_MONITOR_NPUB: $npub}' > "$HTML/config.json"
else
  echo '{}' > "$HTML/config.json"
fi
exec nginx -g "daemon off;"
