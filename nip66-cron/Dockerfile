# NIP-66 monitor cron: runs alongside the app, keeps nsec on server only.
# Node 22 to match the main app Dockerfile and the root package.json engines (>=22.6.0).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.mjs default-relays.mjs ./

ENV NODE_ENV=production
CMD ["node", "index.mjs"]
