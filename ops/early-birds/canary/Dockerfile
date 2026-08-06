FROM node:22.22.0-alpine

RUN apk add --no-cache ffmpeg
WORKDIR /srv/canary
COPY canary-exporter.mjs ./
USER node
EXPOSE 8081
CMD ["node", "canary-exporter.mjs"]
