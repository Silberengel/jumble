# Proxy Setup

Imwald uses same-origin proxy paths in production so browsers do not need cross-origin CORS exceptions.

## Link Preview / RSS Proxy

Set `VITE_PROXY_SERVER` at build time. The current client contract is:

```text
${VITE_PROXY_SERVER}/sites/?url=<encoded-url>
```

For the public deployment this is normally:

```bash
VITE_PROXY_SERVER=https://jumble.imwald.eu
```

Apache/nginx should route `/sites/` to the OG proxy container, before the SPA catch-all.

Apache example:

```apache
ProxyPass        /sites/ http://127.0.0.1:8090/sites/
ProxyPassReverse /sites/ http://127.0.0.1:8090/sites/
ProxyPass        / http://127.0.0.1:8089/
ProxyPassReverse / http://127.0.0.1:8089/
```

## Optional Same-Origin APIs

These are enabled by build-time URLs:

```bash
VITE_READ_ALOUD_TTS_URL=/api/piper-tts
VITE_LANGUAGE_TOOL_URL=/api/languagetool
VITE_TRANSLATE_URL=/api/translate
VITE_ASCIIDOCTOR_SERVER_URL=/api/asciidoctor
```

Proxy targets:

```apache
ProxyPass        /api/piper-tts http://127.0.0.1:9876/api/piper-tts
ProxyPassReverse /api/piper-tts http://127.0.0.1:9876/api/piper-tts
ProxyPass        /api/languagetool http://127.0.0.1:8010
ProxyPassReverse /api/languagetool http://127.0.0.1:8010
ProxyPass        /api/translate http://127.0.0.1:5000
ProxyPassReverse /api/translate http://127.0.0.1:5000
ProxyPass        /api/asciidoctor/ http://127.0.0.1:8091/
ProxyPassReverse /api/asciidoctor/ http://127.0.0.1:8091/
```

## Local development (`npm run dev`)

By default, **`npm run dev` does not require local Docker**. Vite proxies the same paths as production to **https://jumble.imwald.eu**:

| Path | Service |
|------|---------|
| `/sites` | OG link preview / RSS HTML fetch (Puppeteer scraper) |
| `/api/translate` | LibreTranslate (note translation, advanced lab) |
| `/api/languagetool` | LanguageTool (grammar in advanced lab) |
| `/api/piper-tts` | Read-aloud Piper TTS |
| `/api/asciidoctor` | EPUB/PDF export (AsciiDoctor sidecar) |

Set in `.env.development` (same-origin paths; the proxy target is chosen in `vite.config.ts`):

```bash
VITE_DEV_ANCILLARY_PROXY=remote   # default
VITE_PROXY_SERVER=/sites
VITE_READ_ALOUD_TTS_URL=/api/piper-tts
VITE_LANGUAGE_TOOL_URL=/api/languagetool
VITE_TRANSLATE_URL=/api/translate
VITE_ASCIIDOCTOR_SERVER_URL=/api/asciidoctor
```

**Local sidecars instead:** run `npm run dev:all` (starts Docker + sets `VITE_DEV_ANCILLARY_PROXY=local`), or add `VITE_DEV_ANCILLARY_PROXY=local` to `.env.local`.

**Custom remote host:** `VITE_DEV_ANCILLARY_PROXY=https://your-staging.example.com` (same path layout as prod).

For the full production workflow, use `scripts/README-deploy.md` and `docker-compose.prod.yml`.
