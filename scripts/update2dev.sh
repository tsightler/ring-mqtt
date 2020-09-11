#!/usr/bin/env sh
HOME=/app
echo "Please be patient while ring-mqtt is updated to"
echo "the development version from GitHub..."
cd /app
mv ring-mqtt ring-mqtt.orig
git clone -b dev https://github.com/tsightler/ring-mqtt
cd ring-mqtt
npm install --no-progress
chmod +x ring-mqtt.js scripts/*.sh
echo "-------------------------------------------------------"
