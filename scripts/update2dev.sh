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