FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies (sharp fetches its prebuilt libvips binaries here)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- Production stage ---
FROM node:22-bookworm-slim

# sharp's prebuilt linux-x64 binaries need libstdc++ only; no build tools required.
RUN apt-get update && \
    apt-get install -y --no-install-recommends libstdc++6 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
# The container sits on an internal Docker network; loopback-only binding
# would make it unreachable from the app container.
ENV TAPESTRY_HOST=0.0.0.0
ENV TAPESTRY_PORT=3100
# Keep glibc from hoarding libvips' per-operation allocations in many malloc
# arenas; without this, RSS grows unbounded under sustained ingest even
# though the JS heap is flat.
ENV MALLOC_ARENA_MAX=2

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

USER node

EXPOSE 3100

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TAPESTRY_PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
