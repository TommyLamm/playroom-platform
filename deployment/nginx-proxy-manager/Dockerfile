FROM node:22.23.4-bookworm-slim AS security
WORKDIR /security-deps
COPY deployment/nginx-proxy-manager/package.json deployment/nginx-proxy-manager/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --install-strategy=nested --no-audit --no-fund

FROM jc21/nginx-proxy-manager:2.16.0
COPY --from=security /usr/local/bin/node /usr/bin/node
COPY --from=security /security-deps/node_modules /security-deps/node_modules
COPY deployment/nginx-proxy-manager/patch-dependencies.cjs /security-deps/patch-dependencies.cjs
RUN node /security-deps/patch-dependencies.cjs && rm -rf /security-deps
LABEL party.playroom.security-overlay="2026-10-23"
