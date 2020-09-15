#!/usr/bin/env sh
HOME=/app
echo "Updating ring-mqtt to the latest version..."
cd /app
rm ring-mqtt
git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
ln -s ring-mqtt-latest ring-mqtt
cd ring-mqtt
echo "Installing node module dependencies, please wait..."
npm install --no-progress > /dev/null 2>&1
chmod +x ring-mqtt.js scripts/*.sh
