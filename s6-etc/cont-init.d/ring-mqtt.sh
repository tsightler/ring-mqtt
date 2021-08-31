#!/usr/bin/with-contenv bashio
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
    elif [ "${BRANCH}" = "dev" ]; then
        /app/ring-mqtt/scripts/update2dev.sh
    fi
else
    # No options.json found, assume we are in running in standard Docker
    echo "-------------------------------------------------------"
    echo "| Ring Devices via MQTT                               |"
    echo "|                                                     |"
    echo "| Report issues at:                                   |"
    echo "| https://github.com/tsightler/ring-mqtt              |"
    echo "-------------------------------------------------------"

    set +o nounset
    if [ "${BRANCH}" = "latest" ]; then
        /app/ring-mqtt/scripts/update2latest.sh
    elif [ "${BRANCH}" = "dev" ]; then
        /app/ring-mqtt/scripts/update2dev.sh
    fi
fi