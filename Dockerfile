FROM node:22.22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_LIVEKIT_URL

ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL

RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

ARG BEACON_GIT_SHA=unknown
ARG BEACON_BUILD_TIME=unknown
ARG BEACON_DATABASE_SCHEMA_VERSION=unknown

ENV BEACON_GIT_SHA=$BEACON_GIT_SHA \
    BEACON_BUILD_TIME=$BEACON_BUILD_TIME \
    BEACON_DATABASE_SCHEMA_VERSION=$BEACON_DATABASE_SCHEMA_VERSION

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache curl ffmpeg

COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema + migrations + config module for production DB commands
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Guarded one-time event stabilization command (dry-run by default).
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/scripts/weekend-stabilize.ts ./scripts/weekend-stabilize.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/commerce-media-worker.ts ./scripts/commerce-media-worker.ts
# Root-invoked, staging-only Account preparation commands. They are not
# reachable from the application process and accept no caller-supplied paths.
COPY --from=builder --chown=root:root /app/scripts/live-staging ./scripts/live-staging
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/event-stabilization.ts ./src/lib/event-stabilization.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/redact.ts ./src/lib/redact.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/commerce-media-reconciler.ts ./src/lib/commerce-media-reconciler.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db.ts ./src/lib/db.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/livekit-server.ts ./src/lib/livekit-server.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/with-timeout.ts ./src/lib/with-timeout.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
# Full node_modules so prisma/seed and config scripts work in production
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
