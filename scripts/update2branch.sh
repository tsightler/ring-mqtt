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

    # This runs the downloaded version of this script in case there are
    # additonal component upgrade actions that need to be performed
    exec "/app/ring-mqtt-${BRANCH}/scripts/update2branch.sh"
    echo "-------------------------------------------------------"
else
    # Branch has already been initialized, run any post-update command here
    echo "The ring-mqtt-${BRANCH} branch has been updated."

    HELPER_DIR="/app/ring-mqtt-${BRANCH}/ringstream"
    if [ -x "/app/ring-mqtt/ringstream/ringstream" ] && \
       diff -qr -x ringstream "/app/ring-mqtt/ringstream" "${HELPER_DIR}" > /dev/null 2>&1; then
        cp -f "/app/ring-mqtt/ringstream/ringstream" "${HELPER_DIR}/ringstream"
        chmod +x "${HELPER_DIR}/ringstream"
    else
        echo "Building stream helper from source, please wait..."
        apk add --no-cache --virtual .build-deps go > /dev/null 2>&1
        if ( cd "${HELPER_DIR}" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ringstream . ); then
            chmod +x "${HELPER_DIR}/ringstream"
        elif [ -x "/app/ring-mqtt/ringstream/ringstream" ]; then
            echo "WARN: Failed to build stream helper, falling back to the one shipped in the image."
            cp -f "/app/ring-mqtt/ringstream/ringstream" "${HELPER_DIR}/ringstream"
            chmod +x "${HELPER_DIR}/ringstream"
        else
            echo >&2 "ERROR: Failed to build stream helper and no fallback binary available"
        fi
        apk del --no-cache .build-deps > /dev/null 2>&1
        rm -rf /app/go /app/.cache
    fi

    cp -f "/app/ring-mqtt-${BRANCH}/init/s6/services.d/ring-mqtt/run" /etc/services.d/ring-mqtt/run
    chmod +x /etc/services.d/ring-mqtt/run
fi
