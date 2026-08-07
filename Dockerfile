# FareFlow — zero-dependency Node PWA (server.js + /public). Works on any Docker host.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node server.js package.json ./
COPY --chown=node:node public ./public

# /data is where state persists — mount a volume here on hosts that offer one
RUN mkdir -p /data && chown -R node:node /data
ENV DATA_FILE=/data/data.json

# Default port matches Hugging Face Spaces; Render/Railway/Fly inject their own PORT, which wins.
ENV PORT=7860
EXPOSE 7860

USER node
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
