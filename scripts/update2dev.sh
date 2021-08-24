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
echo "-------------------------------------------------------"
echo "Downloading and installing rtsp-simple-server"
apk add --no-cache mosquitto-clients
APKARCH="$(dpkg --print-architecture)"
case "${APKARCH}" in
    'x86_64')
        wget -O rtsp-simple-server_binary.tar.gz https://github.com/aler9/rtsp-simple-server/releases/download/v0.17.2/rtsp-simple-server_v0.17.2_linux_amd64.tar.gz
        ;;
    'aarch64')
        wget -O rtsp-simple-server_binary.tar.gz https://github.com/aler9/rtsp-simple-server/releases/download/v0.17.2/rtsp-simple-server_v0.17.2_linux_arm64v8.tar.gz
        ;;
    'armv7')
        wget -O rtsp-simple-server_binary.tar.gz https://github.com/aler9/rtsp-simple-server/releases/download/v0.17.2/rtsp-simple-server_v0.17.2_linux_armv7.tar.gz
        ;;
    'armhf')
        wget -O rtsp-simple-server_binary.tar.gz https://github.com/aler9/rtsp-simple-server/releases/download/v0.17.2/rtsp-simple-server_v0.17.2_linux_armv6.tar.gz
        ;;
    *) echo >&2 "error: unsupported architecture '$dpkgArch' (likely packaging update needed)"; exit 1 ;;
esac
tar zxvfp rtsp-simple-server_binary.tar.gz
echo "-------------------------------------------------------"