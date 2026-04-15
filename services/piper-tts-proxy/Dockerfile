# Build from repo root: docker build -f services/piper-tts-proxy/Dockerfile -t imwald-piper-tts-proxy .
FROM node:20-alpine
WORKDIR /app
COPY services/piper-tts-proxy/server.ts services/piper-tts-proxy/http.ts ./
RUN npm init -y >/dev/null && npm install tsx@4.19.2 --omit=dev
ENV NODE_ENV=production
ENV PORT=9876
ENV PIPER_TTS_HOST=piper-tts
ENV PIPER_TTS_PORT=10200
EXPOSE 9876
CMD ["npx", "tsx", "http.ts"]
