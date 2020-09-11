#!/usr/bin/env sh
echo "-------------------------------------------------------"
echo "Updating ring-mqtt to latest main branch version..."
cd /app
mv ring-mqtt ring-mqtt.orig
git clone https://github.com/tsightler/ring-mqtt
cd ring-mqtt
npm install
chmod +x ring-mqtt.js
echo "-------------------------------------------------------"