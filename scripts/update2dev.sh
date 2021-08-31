#!/usr/bin/env bash
HOME=/app
echo "Updating ring-mqtt to the development version..."
cd /app
if [ ! -d /app/ring-mqtt-dev ]; then
    git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
    cd /app/ring-mqtt-dev
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh

    echo "-------------------------------------------------------"
    echo "Downloading and installing s6-overlay..."
        case "${APKARCH}" in
        'x86_64')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-amd64.tar.gz" | tar zxf - -C /
            ;;
        'aarch64')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-aarch64.tar.gz" | tar zxf - -C /
            ;;
        'armv7')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-arm.tar.gz" | tar zxf - -C /
            ;;
        'armhf')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-armhf.tar.gz" | tar zxf - -C /
            ;;
        *) 
            echo >&2 "ERROR: Unsupported architecture '$APKARCH'"; 
            exit 1 
            ;;
    esac
    mkdir -p /etc/fix-attrs.d
    mkdir -p /etc/services.d
    cp -a /app/ring-mqtt-dev/s6-etc/* /
    echo "-------------------------------------------------------"
else
    cd /app/ring-mqtt-dev
    echo "Adding mostquitto-clients..."
    apk add --no-cache mosquitto-clients
    echo "Downloading and installing rtsp-simple-server..."
    APKARCH="$(apk --print-arch)"
    mkdir -p bin; cd bin
    case "${APKARCH}" in
        'x86_64')
            curl -L -s https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_amd64.tar.gz | tar zxf - rtsp-simple-server
            ;;
        'aarch64')
            curl -L -s https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_arm64v8.tar.gz | tar zxf - rtsp-simple-server
            ;;
        'armv7')
            curl -L -s https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_armv7.tar.gz | tar zxf - rtsp-simple-server
            ;;
        'armhf')
            curl -L -s https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_armv6.tar.gz | tar zxf - rtsp-simple-server
            ;;
        *) 
            echo >&2 "ERROR: Unsupported architecture '$APKARCH'"; 
            exit 1 
            ;;
    esac
    cd ..
    echo "-------------------------------------------------------"
fi