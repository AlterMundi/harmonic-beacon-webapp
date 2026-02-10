FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- Production stage ---
FROM node:22-slim

# ffmpeg for OGG→PCM decoding; libstdc++6 for @livekit/rtc-node native bindings
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libstdc++6 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

USER node

CMD ["node", "dist/index.js"]
