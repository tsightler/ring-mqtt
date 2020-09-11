#!/usr/bin/sh
echo "-------------------------------------------------------"
echo "Updating ring-mqtt to latest dev branch version..."
cd /app
mv ring-mqtt ring-mqtt.orig
git clone -b dev https://github.com/tsightler/ring-mqtt
cd ring-mqtt
npm install
chmod +x ring-mqtt.js
echo "-------------------------------------------------------"