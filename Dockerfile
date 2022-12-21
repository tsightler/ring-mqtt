FROM alpine:3.16.2

ENV LANG="C.UTF-8" \
    PS1="$(whoami)@$(hostname):$(pwd)$ " \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=10000 \
    TERM="xterm-256color"
    
COPY . /app/ring-mqtt
RUN S6_VERSION="v3.1.2.1" && \
    BASHIO_VERSION="v0.14.3" && \
    RSS_VERSION="v0.21.0" && \
    apk add --no-cache tar xz git libcrypto1.1 libssl1.1 musl-utils musl bash curl jq tzdata nodejs npm mosquitto-clients && \
    APK_ARCH="$(apk --print-arch)" && \
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
    case "${APK_ARCH}" in \
        x86_64) \
            RSS_ARCH="amd64";; \
        aarch64) \
            RSS_ARCH="arm64v8";; \
        armv7|armhf) \
            RSS_ARCH="armv7";; \
        *) \
            echo >&2 "ERROR: Unsupported architecture '$APK_ARCH'" \
            exit 1;; \
    esac && \
    curl -L -s "https://github.com/aler9/rtsp-simple-server/releases/download/${RSS_VERSION}/rtsp-simple-server_${RSS_VERSION}_linux_${RSS_ARCH}.tar.gz" | tar zxf - -C /usr/local/bin rtsp-simple-server && \
    curl -J -L -o /tmp/bashio.tar.gz "https://github.com/hassio-addons/bashio/archive/${BASHIO_VERSION}.tar.gz" && \
    mkdir /tmp/bashio && \
    tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio && \
    mv /tmp/bashio/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    chmod +x /app/ring-mqtt/scripts/*.sh && \
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
