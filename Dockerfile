FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm run build && npm test && npm prune --omit=dev

FROM node:24-bookworm-slim
ARG APP_COMMIT=development
ENV APP_COMMIT=$APP_COMMIT
LABEL org.opencontainers.image.revision=$APP_COMMIT
ENV NODE_ENV=production BIND_HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
