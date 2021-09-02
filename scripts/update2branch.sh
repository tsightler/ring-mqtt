#!/usr/bin/env bash
HOME=/app
echo "Updating ring-mqtt to the ${BRANCH} version..."
cd /app
if [ ! -d "/app/ring-mqtt-${BRANCH}" ]; then
    if [ "${BRANCH}" = "latest" ]; then
        git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
    else 
        git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
    fi
    cd "/app/ring-mqtt-${BRANCH}"
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh

    # This runs the just updated version of this script in case there are 
    # additonal special commands that need to be run outside of the generic
    # update script.
    exec "/app/ring-mqtt-${BRANCH}/scripts/update2branch.sh"
fi
echo "-------------------------------------------------------"