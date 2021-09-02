#!/usr/bin/env bash
HOME=/app
echo "Updating ring-mqtt to the latest version..."
cd /app
if [ ! -d /app/ring-mqtt-latest ]; then
    git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
    cd /app/ring-mqtt-latest
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh
    exec /app/ring-mqtt-latest/scripts/update2latest.sh
fi
echo "-------------------------------------------------------"