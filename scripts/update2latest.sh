#!/usr/bin/env sh
HOME=/app
echo "Updating ring-mqtt to the latest version..."
cd /app
if [ -d /app/ring-mqtt-latest ]; then
    rm -Rf /app/ring-mqtt-latest
fi
git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
cd /app/ring-mqtt-latest
echo "Installing node module dependencies, please wait..."
npm install --no-progress > /dev/null 2>&1
chmod +x ring-mqtt.js scripts/*.sh
echo "-------------------------------------------------------"