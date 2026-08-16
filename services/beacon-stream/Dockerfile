FROM node:22-alpine

WORKDIR /srv/beacon-stream
COPY package.json ./
COPY src ./src
COPY scripts ./scripts

USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
