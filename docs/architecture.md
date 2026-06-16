# Architecture

Imwald is a browser-first Nostr client with optional runtime sidecars.

## Browser app (`src/`)

- **Vite + React 18** SPA served as static assets (`dist/`) behind nginx in production.
- **Routing:** custom `PageManager` with primary (sidebar/bottom nav) and secondary (stacked panels) pages.
- **Nostr:** `src/services/client.service.ts` orchestrates the relay pool; sibling modules split query, events, and replaceable-event concerns.
- **Storage:** IndexedDB via `src/services/indexed-db.service.ts` for offline cache, lists, and publications.

## Repo sidecars (not bundled into the main app)

| Path | Role |
|------|------|
| [`server/`](../server/) | Node CJS helpers for Tor/I2P relay WebSocket proxy (dev Vite plugin + prod nginx) |
| [`services/piper-tts-proxy/`](../services/piper-tts-proxy/) | HTTP bridge to Wyoming Piper for read-aloud TTS |
| [`nip66-cron/`](../nip66-cron/) | Standalone cron that publishes NIP-66 relay monitor events |

## Docker optional profiles

See [`docker-compose.dev.yml`](../docker-compose.dev.yml) profiles:

- **editor-tools:** LanguageTool, LibreTranslate (grammar/translate in Advanced Event Lab)
- **local-tts:** Piper Wyoming + `piper-tts-proxy`
- **og-proxy:** Open Graph scraper for link previews

These services are product features, not part of the static JS bundle.

## Static assets

- [`resources/`](../resources/) — source marketing images (banner, favicon, OG)
- [`public/`](../public/) — deployed copies consumed by the app and PWA manifest
