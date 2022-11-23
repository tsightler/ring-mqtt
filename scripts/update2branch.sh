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
    cd "/app/ring-mqtt-${BRANCH}"
    RSS_VERSION="v0.20.0"
    APK_ARCH="$(apk --print-arch)"
    case "${APK_ARCH}" in
        x86_64)
            RSS_ARCH="amd64";;
        aarch64)
            RSS_ARCH="arm64v8";;
        armv7|armhf)
            RSS_ARCH="armv7";;
        *)
            echo >&2 "ERROR: Unsupported architecture '$APK_ARCH'"
            exit 1;;
    esac
    rm /usr/local/bin/rtsp-simple-server
    curl -L -s "https://github.com/aler9/rtsp-simple-server/releases/download/${RSS_VERSION}/rtsp-simple-server_${RSS_VERSION}_linux_${RSS_ARCH}.tar.gz" | tar zxf - -C /usr/local/bin rtsp-simple-server
fi