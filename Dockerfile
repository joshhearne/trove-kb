# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholders only. src/lib/env.ts validates the environment at import time,
# which happens during `next build`. Real values come from the runtime env.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder-value-unused-at-runtime \
    APP_URL=http://localhost:3000
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
# Which build this is, for Admin -> System health and the host updater's
# health check. .github/workflows/images.yml stamps them; a local build gets
# them from scripts/build-with-version.sh, or goes without.
ARG TROVE_BUILD_VERSION=
ARG TROVE_BUILD_COMMIT=
ARG TROVE_BUILT_AT=
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TROVE_BUILD_VERSION=${TROVE_BUILD_VERSION} \
    TROVE_BUILD_COMMIT=${TROVE_BUILD_COMMIT} \
    TROVE_BUILT_AT=${TROVE_BUILT_AT}
RUN addgroup -S -g 1001 nodejs \
 && adduser -S -u 1001 -G nodejs trove \
 && mkdir -p /data/uploads \
 && chown -R trove:nodejs /data/uploads

COPY --from=builder --chown=trove:nodejs /app/public ./public
COPY --from=builder --chown=trove:nodejs /app/.next/standalone ./
COPY --from=builder --chown=trove:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=trove:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=trove:nodejs /app/dist ./dist
# The What's new entries this build brings (src/server/services/whats-new.ts).
COPY --from=builder --chown=trove:nodejs /app/changes ./changes
COPY --chown=trove:nodejs docker/entrypoint.sh /app/entrypoint.sh

USER trove
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
