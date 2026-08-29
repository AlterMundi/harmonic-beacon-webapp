FROM node:22.18.0-alpine3.22

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations

USER node
ENV NODE_ENV=production
EXPOSE 3300
CMD ["node", "src/server.mjs"]
