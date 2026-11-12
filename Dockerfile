# syntax=docker/dockerfile:1

# Node.js 26 LTS (2026-11-11 security release).
# Pinned by digest for reproducible, tamper-resistant builds. To update:
#   docker buildx imagetools inspect node:<version>-alpine3.24, then replace the index digest.
ARG NODE_IMAGE=node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

# ---- build: compile TypeScript ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- prod deps only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- runtime ----
FROM ${NODE_IMAGE}
# - apply latest Alpine security patches
# - CA bundle for outbound HTTPS (Apple, Google, Maven, Gradle, endoflife.date, ...)
# - tini as PID 1 for proper signal handling / zombie reaping
# - remove npm/npx/corepack/yarn: not needed at runtime, shrinks attack surface & CVE count
RUN apk upgrade --no-cache \
 && apk add --no-cache ca-certificates tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
# App files stay root-owned and read-only for the runtime user (it cannot modify its own code).
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# PWA assets: server resolves <dist>/../public -> /app/public
COPY public ./public
COPY DISCLAIMER.md DISCLAIMER.en.md SOURCES.md ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
