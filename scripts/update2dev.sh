#!/usr/bin/env sh
HOME=/app
echo "Updating ring-mqtt to the development version..."
cd /app
rm ring-mqtt
git clone -b dev https://github.com/tsightler/ring-mqtt-dev
ln -s /app/ring-mqtt-dev /app/ring-mqtt
cd /app/ring-mqtt
echo "Installing node module dependencies, please wait..."
npm install --no-progress > /dev/null 2>&1
chmod +x ring-mqtt.js scripts/*.sh
