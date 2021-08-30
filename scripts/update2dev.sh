#!/usr/bin/env sh
HOME=/app
echo "Updating ring-mqtt to the development version..."
cd /app
if [ -d /app/ring-mqtt-dev ]; then
    rm -Rf /app/ring-mqtt-dev
fi
git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
cd /app/ring-mqtt-dev
echo "Installing node module dependencies, please wait..."
npm install --no-progress > /dev/null 2>&1
chmod +x ring-mqtt.js scripts/*.sh

# Temporary for 4.8 with livestreaming and s6-overlay
cd /app/ring-mqtt-dev
echo "-------------------------------------------------------"
echo "Adding mostquitto-clients..."
apk add --no-cache mosquitto-clients
echo "Downloading and installing rtsp-simple-server..."
APKARCH="$(apk --print-arch)"
mkdir -p bin; cd bin
case "${APKARCH}" in
    'x86_64')
        wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_amd64.tar.gz
        ;;
    'aarch64')
        wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_arm64v8.tar.gz
        ;;
    'armv7')
        wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_armv7.tar.gz
        ;;
    'armhf')
        wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_armv6.tar.gz
        ;;
    *) 
        echo >&2 "ERROR: Unsupported architecture '$APKARCH'"; 
        exit 1 
        ;;
esac
tar zxvfp rtsp-simple-server.tar.gz rtsp-simple-server
rm rtsp-simple-server.tar.gz
cd ..
echo "-------------------------------------------------------"
echo "Downloading and installing s6-overlay..."
    case "${APKARCH}" in
    'x86_64')
        curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-amd64.tar.gz" | tar zxvf - -C /
        ;;
    'aarch64')
        curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-aarch64.tar.gz" | tar zxvf - -C /
        ;;
    'armv7')
        curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-arm.tar.gz" | tar zxvf - -C /
        ;;
    'armhf')
        curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-armhf.tar.gz" | tar zxvf - -C /
        ;;
    *) 
        echo >&2 "ERROR: Unsupported architecture '$APKARCH'"; 
        exit 1 
        ;;
esac
mkdir -p /etc/fix-attrs.d
mkdir -p /etc/services.d