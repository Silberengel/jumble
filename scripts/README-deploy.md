# Deploy Imwald with docker-compose.prod.yml (remote server)

Workflow: **build and push locally** → **pull and run on the server**.

## Local: build and push

From the **repo root** on your machine:

```bash
docker login   # once, if needed
./scripts/build-and-push-prod.sh
```

This builds and pushes **three** images, each with `latest` and the version from `package.json` (e.g. `17.0.0`):

- **Main app (Imwald):** `silberengel/imwald-jumble`
- **NIP-66 monitor:** `silberengel/imwald-jumble-nip66-monitor`
- **Piper HTTP proxy:** `silberengel/imwald-piper-tts-proxy` (Wyoming Piper still pulls `silberengel/wyoming-piper` and `silberengel/wikistr` on the server.)

Registry paths keep the historical `imwald-jumble` name; retagging is optional and requires updating `docker-compose.prod.yml`.

## Remote server: one-time setup

1. **Docker**  
   Install Docker and Docker Compose (v2).

2. **Clone the repo** (so you have `docker-compose.prod.yml`):
   ```bash
   git clone <your-repo-url> jumble
   cd jumble
   ```

3. **Optional env file** (e.g. for NIP-66 monitor):
   ```bash
   # .env next to docker-compose.prod.yml
   NIP66_MONITOR_NSEC=nsec1...
   NIP66_MONITOR_NPUB=npub1...
   ```

4. **Once per machine** (LibreTranslate bind mounts need UID 1032 on the host dirs):
   ```bash
   bash scripts/ensure-libretranslate-dirs.sh
   ```

## Remote server: pull and run

Use a **current** `docker-compose.prod.yml` from this repo (`git pull` in the clone). If `docker compose pull` only lists two images, the file is outdated and **LanguageTool / LibreTranslate will never start**.

After you’ve pushed from local:

```bash
cd jumble
git pull
bash scripts/ensure-libretranslate-dirs.sh   # once per host
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

That starts the **full** stack in `docker-compose.prod.yml` (app, NIP-66 monitor, OG proxy, Piper, LanguageTool, LibreTranslate). The SPA is on **port 8089**; see `docker-compose.prod.yml` header for Apache paths.

**Grammar + translate in the browser** also require the SPA to be built with API paths baked in, for example:

`LANGUAGE_TOOL_URL=/api/languagetool TRANSLATE_URL=/api/translate ./scripts/build-and-push-prod.sh`

and Apache (or nginx) must proxy `/api/languagetool` → `127.0.0.1:8010` and `/api/translate` → `127.0.0.1:5000`.

**Shared host:** if you already run another `og-proxy` on `127.0.0.0.1:8090` or another Wyoming Piper on the same ports, `docker compose up -d` can fail with a port or name conflict. Either stop the duplicates or start only the pieces you need, e.g. `docker compose up -d jumble jumble-nip66-monitor languagetool libretranslate` (and point `PIPER_TTS_HOST` / Apache at your existing Piper stack if applicable).

Equivalent one-liner: `npm run stack:remote`

Images default to `:latest`; to pin a version, set image tags in `docker-compose.prod.yml`.

## Useful commands (server)

```bash
# Status
docker compose -f docker-compose.prod.yml ps

# Logs
docker compose -f docker-compose.prod.yml logs -f

# Stop
docker compose -f docker-compose.prod.yml down
```
