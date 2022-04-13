#!/usr/bin/env bash
HOME=/app
cd /app
if [ ! -d "/app/ring-mqtt-${BRANCH}" ]; then
    echo "Updating ring-mqtt to the ${BRANCH} version..."
    if [ "${BRANCH}" = "latest" ]; then
        git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
    else 
        git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
    fi
    cd "/app/ring-mqtt-${BRANCH}"
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh

    # This runs the just updated version of this script in case there are 
    # additonal special commands that need to be run outside of the generic
    # update script.
    exec "/app/ring-mqtt-${BRANCH}/scripts/update2branch.sh"
    echo "-------------------------------------------------------"
else
    # Branch has already been initialized, perform optional component update actions here
    APKARCH="$(apk --print-arch)"
    case "${APKARCH}" in \
        x86_64) \
            RSSARCH="amd64";; \
        aarch64) \
            RSSARCH="arm64v8";; \
        armv7|armhf) \
            RSSARCH="armv7";; \
        *) \
            echo >&2 "ERROR: Unsupported architecture '$APKARCH'" \
            exit 1;; \
    esac
    curl -L -s "https://github.com/aler9/rtsp-simple-server/releases/download/v0.18.0/rtsp-simple-server_v0.18.0_linux_${RSSARCH}.tar.gz" | tar zxf - -C /usr/local/bin rtsp-simple-server
fi