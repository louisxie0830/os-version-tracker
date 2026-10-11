# syntax=docker/dockerfile:1

# Node 26 = latest Node.js release line (nodejs.org/dist/index.json -> v26.11.1, 2026-10-07).
# Pinned by digest for reproducible, tamper-resistant builds. To update:
#   docker buildx imagetools inspect node:26-alpine   (or Docker Hub API) and replace the digest.
ARG NODE_IMAGE=node:26.11.1-alpine3.24@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a

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
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
