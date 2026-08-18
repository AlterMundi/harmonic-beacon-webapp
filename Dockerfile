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
COPY --from=builder --chown=nextjs:nodejs /app/scripts/listener-quiesce-for-free-for-all.ts ./scripts/listener-quiesce-for-free-for-all.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/listener-withdrawal-operator.ts ./scripts/listener-withdrawal-operator.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/beacon-account/check-migrations.mjs ./scripts/beacon-account/check-migrations.mjs
COPY --from=builder --chown=nextjs:nodejs /app/ops/beacon-account/validate.mjs ./ops/beacon-account/validate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/ops/beacon-account/account.production.env.example ./ops/beacon-account/account.production.env.example
COPY --from=builder --chown=nextjs:nodejs /app/ops/beacon-account/account.staging.env.example ./ops/beacon-account/account.staging.env.example
COPY --from=builder --chown=nextjs:nodejs /app/ops/beacon-account/database.staging.env.example ./ops/beacon-account/database.staging.env.example
COPY --from=builder --chown=nextjs:nodejs /app/ops/beacon-account/account-mail-worker.production.env.example ./ops/beacon-account/account-mail-worker.production.env.example
COPY --from=builder --chown=nextjs:nodejs /app/ops/beacon-account/account-mail-worker.staging.env.example ./ops/beacon-account/account-mail-worker.staging.env.example
COPY --from=builder --chown=nextjs:nodejs /app/ops/listener-identity-staging/validate.mjs ./ops/listener-identity-staging/validate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/provision-account-authority.ts ./scripts/provision-account-authority.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/process-account-mail-outbox.ts ./scripts/process-account-mail-outbox.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/event-stabilization.ts ./src/lib/event-stabilization.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/redact.ts ./src/lib/redact.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/commerce-media-reconciler.ts ./src/lib/commerce-media-reconciler.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db.ts ./src/lib/db.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/session-auth.ts ./src/lib/session-auth.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/account ./src/lib/account
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/listener/consumer-withdrawal.ts ./src/lib/listener/consumer-withdrawal.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/early-birds/account-id.ts ./src/lib/early-birds/account-id.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/early-birds/access.ts ./src/lib/early-birds/access.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/early-birds/membership.ts ./src/lib/early-birds/membership.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/early-birds/quota.ts ./src/lib/early-birds/quota.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/early-birds/stream.ts ./src/lib/early-birds/stream.ts
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
