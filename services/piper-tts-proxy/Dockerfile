# Build from repo root: docker build -f services/piper-tts-proxy/Dockerfile -t imwald-piper-tts-proxy .
FROM node:22-alpine
WORKDIR /app
COPY services/piper-tts-proxy/server.ts services/piper-tts-proxy/http.ts ./
ENV NODE_ENV=production
ENV PORT=9876
ENV PIPER_TTS_HOST=piper-tts
ENV PIPER_TTS_PORT=10200
EXPOSE 9876
CMD ["node", "--experimental-strip-types", "http.ts"]
