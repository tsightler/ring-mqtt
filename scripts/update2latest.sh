#!/usr/bin/env sh
echo "-------------------------------------------------------"
echo "Updating ring-mqtt to Github main branch..."
cd /app
mv ring-mqtt ring-mqtt.orig
git clone https://github.com/tsightler/ring-mqtt
cd ring-mqtt
HOME=/app
npm install
chmod +x ring-mqtt.js scripts/*.sh
echo "-------------------------------------------------------"