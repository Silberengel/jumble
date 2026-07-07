# Build from repo root: docker build -f nip66-cron/Dockerfile -t imwald-jumble-nip66-monitor .
# Node 22 to match the main app Dockerfile and the root package.json engines (>=22.6.0).
FROM node:22-alpine

WORKDIR /app

COPY nip66-cron/package.json nip66-cron/package-lock.json ./
RUN npm ci --omit=dev

COPY nip66-cron/index.mjs nip66-cron/default-relays.mjs ./

ENV NODE_ENV=production
CMD ["node", "index.mjs"]
