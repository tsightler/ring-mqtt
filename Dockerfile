FROM node:lts-alpine3.14

ENV LANG="C.UTF-8" \
    TERM="xterm-256color"

COPY . /app/ring-mqtt
RUN apk add --no-cache tar git libcrypto1.1 libssl1.1 && \
    apk add --no-cache musl-utils musl bash curl jq tzdata && \
    curl -J -L -o /tmp/bashio.tar.gz "https://github.com/hassio-addons/bashio/archive/v0.13.1.tar.gz" && \
    mkdir /tmp/bashio && \
    tar zxvf /tmp/bashio.tar.gz --strip 1 -C /tmp/bashio && \
    mv /tmp/bashio/lib /usr/lib/bashio && \
    ln -s /usr/lib/bashio/bashio /usr/bin/bashio && \
    mv /app/ring-mqtt /app/ring-mqtt-docker && \
    ln -s /app/ring-mqtt-docker /app/ring-mqtt && \
    chmod +x /app/ring-mqtt/scripts/*.sh && \
    mkdir /data && \
    chmod 777 /data /app && \
    cd /app/ring-mqtt && \
    npm install && \
    rm -Rf /root/.npm && \
    chmod +x ring-mqtt.js && \
    rm -f -r /tmp/*
ENTRYPOINT [ "/app/ring-mqtt/scripts/entrypoint.sh" ]
ARG BUILD_VERSION
ARG BUILD_DATE

LABEL \
    io.hass.name="Ring Device Integration via MQTT" \
    io.hass.description="Home Assistant Community Add-on for Ring Devices" \
    io.hass.type="addon" \
    io.hass.version=${BUILD_VERSION} \
    maintainer="Tom Sightler <tsightler@gmail.com>" \
    org.opencontainers.image.title="Ring Device Integration via MQTT" \
    org.opencontainers.image.description="Home Assistant Community Add-on for Ring Devices" \
    org.opencontainers.image.authors="Tom Sightler <tsightler@gmail.com> (and various other contributors)" \
    org.opencontainers.image.licenses="MIT" \
    org.opencontainers.image.source="https://github.com/tsightler/ring-mqtt" \
    org.opencontainers.image.documentation="https://github.com/tsightler/README.md" \
    org.opencontainers.image.created=${BUILD_DATE} \
    org.opencontainers.image.version=${BUILD_VERSION}