FROM alpine:3.19

# Install dependencies
RUN apk add --no-cache \
    ffmpeg \
    ca-certificates \
    tzdata \
    wget

# Download go2rtc binary
ARG GO2RTC_VERSION=1.9.14
ADD https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_amd64 /usr/local/bin/go2rtc
RUN chmod +x /usr/local/bin/go2rtc

# Create user with configurable UID/GID
ARG UID=1000
ARG GID=1000
RUN addgroup -g ${GID} go2rtc && \
    adduser -D -u ${UID} -G go2rtc go2rtc

# Create directories
RUN mkdir -p /etc/go2rtc /data && \
    chown -R go2rtc:go2rtc /etc/go2rtc /data

# Copy config and entrypoint
COPY go2rtc.yaml /etc/go2rtc/go2rtc.yaml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && \
    chown go2rtc:go2rtc /etc/go2rtc/go2rtc.yaml /entrypoint.sh

USER go2rtc

EXPOSE 1984 8555/tcp 8555/udp

ENTRYPOINT ["/entrypoint.sh"]
CMD ["go2rtc", "-config", "/etc/go2rtc/go2rtc.yaml"]
