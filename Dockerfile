# Build the Go stream helper, which terminates the Ring WebRTC session and feeds
# RTP to ffmpeg. Cross compiled from the build host rather than emulated, since
# building under QEMU for arm is extremely slow.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS gobuilder
ARG TARGETARCH
ARG TARGETVARIANT
WORKDIR /src
COPY ringstream/go.mod ringstream/go.sum ./
RUN go mod download
COPY ringstream/ ./
RUN case "${TARGETVARIANT}" in \
        v6) export GOARM=6 ;; \
        v7) export GOARM=7 ;; \
    esac && \
    CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags "-s -w" -o /out/ringstream .

FROM node:jod-alpine

ENV LANG="C.UTF-8" \
    PS1="$(whoami)@$(hostname):$(pwd)$ " \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=10000 \
    TERM="xterm-256color"

COPY . /app/ring-mqtt
COPY --from=gobuilder /out/ringstream /app/ring-mqtt/ringstream/ringstream
RUN S6_VERSION="v3.2.2.0" && \
    BASHIO_VERSION="v0.17.5" && \
    APK_ARCH="$(apk --print-arch)" && \
    apk add --no-cache tar xz git bash curl tzdata && \
    curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/${S6_VERSION}/s6-overlay-noarch.tar.xz" | tar -Jxpf - -C / && \
    case "${APK_ARCH}" in \
        aarch64|armhf|x86_64) \
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/${S6_VERSION}/s6-overlay-${APK_ARCH}.tar.xz" | tar Jxpf - -C / ;; \
        armv7) \
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/${S6_VERSION}/s6-overlay-arm.tar.xz" | tar Jxpf - -C / ;; \
        *) \
            echo >&2 "ERROR: Unsupported architecture '$APK_ARCH'" \
            exit 1;; \
    esac && \
    mkdir -p /etc/fix-attrs.d && \
    mkdir -p /etc/services.d && \
    cp -a /app/ring-mqtt/init/s6/* /etc/. && \
    chmod +x /etc/cont-init.d/*.sh && \
    chmod +x /etc/services.d/ring-mqtt/* && \
    rm -Rf /app/ring-mqtt/init && \
    rm -rf /app/ring-mqtt/bin && \
    curl -J -L -o /tmp/bashio.tar.gz "https://github.com/hassio-addons/bashio/archive/${BASHIO_VERSION}.tar.gz" && \
    mkdir /tmp/bashio && \
    tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio && \
    mv /tmp/bashio/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    chmod +x /app/ring-mqtt/scripts/*.sh && \
    chmod +x /app/ring-mqtt/ringstream/ringstream && \
    mkdir /data && \
    chmod 777 /data /app /run && \
    cd /app/ring-mqtt && \
    chmod +x ring-mqtt.js && \
    chmod +x init-ring-mqtt.js && \
    npm install && \
    rm -Rf /root/.npm && \
    rm -f -r /tmp/*
ENTRYPOINT [ "/init" ]

EXPOSE 8554/tcp
EXPOSE 55123/tcp

ARG BUILD_VERSION
ARG BUILD_DATE

LABEL \
    io.hass.name="Ring-MQTT with Video Streaming" \
    io.hass.description="Home Assistant Community Add-on for Ring Devices" \
    io.hass.type="addon" \
    io.hass.version=${BUILD_VERSION} \
    maintainer="Tom Sightler <tsightler@gmail.com>" \
    org.opencontainers.image.title="Ring-MQTT with Video Streaming" \
    org.opencontainers.image.description="Intergrate wtih Ring devices using MQTT/RTSP" \
    org.opencontainers.image.authors="Tom Sightler <tsightler@gmail.com> (and various other contributors)" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.source="https://github.com/tsightler/ring-mqtt" \
    org.opencontainers.image.documentation="https://github.com/tsightler/README.md" \
    org.opencontainers.image.created=${BUILD_DATE} \
    org.opencontainers.image.version=${BUILD_VERSION}
