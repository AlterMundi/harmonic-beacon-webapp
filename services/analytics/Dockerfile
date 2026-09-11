FROM node:22.18.0-alpine3.22

ARG ANALYTICS_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=$ANALYTICS_SOURCE_REVISION
ENV ANALYTICS_BUILD_REVISION=$ANALYTICS_SOURCE_REVISION

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations

USER node
ENV NODE_ENV=production
EXPOSE 3300
CMD ["node", "src/server.mjs"]
