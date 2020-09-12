#!/usr/bin/env bashio

# If options.json exist we are running as addon
if [ -f /data/options.json ]; then
    echo "-------------------------------------------------------"
    echo "| Ring Device Integration via MQTT                    |"
    echo "| Addon for Home Assistant                            |"
    echo "|                                                     |"
    echo "| Report issues at:                                   |"
    echo "| https://github.com/tsightler/ring-mqtt-hassio-addon |"
    echo "-------------------------------------------------------"
    # Use bashio to get configured branch
    export BRANCH=$(bashio::config "branch")
    if [ "${BRANCH}" = "latest" ]; then
        /app/ring-mqtt/scripts/update2latest.sh
        echo "-------------------------------------------------------"
    elif [ "${BRANCH}" = "dev" ]; then
        /app/ring-mqtt/scripts/update2dev.sh
        echo "-------------------------------------------------------"
    fi
    exec /app/ring-mqtt/scripts/run-addon.sh
else
    # No options.json found, assume we are in running in standard Docker
    set +o nounset
    if [ ! -z "${DEBUG}" ]; then
        echo "-------------------------------------------------------"
        echo "| Ring Devices via MQTT                               |"
        echo "|                                                     |"
        echo "| Report issues at:                                   |"
        echo "| https://github.com/tsightler/ring-mqtt              |"
        echo "-------------------------------------------------------"
    fi
    set +o nounset
    if [ "${BRANCH}" = "latest" ]; then
        /app/ring-mqtt/scripts/update2latest.sh
    elif [ "${BRANCH}" = "dev" ]; then
        /app/ring-mqtt/scripts/update2dev.sh
    fi
    if [ ! -z "${DEBUG}" ]; then
        if [ "${BRANCH}" = "latest" ] || [ "${BRANCH}" = "dev" ] ; then
            echo "-------------------------------------------------------"
        fi
        echo -n "ring-mqtt.js version: "
        echo $(cat /app/ring-mqtt/package.json | grep version | cut -f4 -d'"')
        echo "-------------------------------------------------------"
    fi
    echo "Running ring-mqtt..."
    ISDOCKER=true exec /app/ring-mqtt/ring-mqtt.js
fi