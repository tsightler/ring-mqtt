#!/usr/bin/env bash
HOME=/app
cd /app
if [ ! -d "/app/ring-mqtt-${BRANCH}" ]; then
    echo "Updating ring-mqtt to the ${BRANCH} version..."
    if [ "${BRANCH}" = "latest" ]; then
        git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
    else 
        git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
    fi
    cd "/app/ring-mqtt-${BRANCH}"
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh

    # This runs the downloaded version of this script in case there are 
    # additonal component upgrade actions that need to be performed
    exec "/app/ring-mqtt-${BRANCH}/scripts/update2branch.sh"
    echo "-------------------------------------------------------"
else
    cp -f "/app/ring-mqtt-${BRANCH}/init/s6/services.d/ring-mqtt/run" /etc/services.d/ring-mqtt/run
    chmod +x /etc/services.d/ring-mqtt/run
    cp -f "/app/ring-mqtt-${BRANCH}/init/s6/services.d/ring-mqtt/finish" /etc/services.d/ring-mqtt/finish
    chmod +x /etc/services.d/ring-mqtt/finish

    # Branch has already been initialized, run any post-update command here
    echo "The ring-mqtt-${BRANCH} has been updated."
fi