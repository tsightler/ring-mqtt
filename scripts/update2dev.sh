#!/usr/bin/env sh
echo "-------------------------------------------------------"
echo "Updating ring-mqtt to Github dev branch..."
cd /app
mv ring-mqtt ring-mqtt.orig
git clone -b dev https://github.com/tsightler/ring-mqtt
cd ring-mqtt
npm install
chmod +x ring-mqtt.js scripts/*.sh
echo "-------------------------------------------------------"