#!/usr/bin/env sh
HOME=/app
echo "Updating ring-mqtt to the latest version..."
cd /app
mv ring-mqtt ring-mqtt.orig
git clone https://github.com/tsightler/ring-mqtt
cd ring-mqtt
echo "Installing node module dependencies, please wait..."
npm install --no-progress > /dev/null 2>&1
chmod +x ring-mqtt.js scripts/*.sh
