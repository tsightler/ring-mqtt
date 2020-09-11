#!/usr/bin/env bashio

# If options.json exist we are running as addon
if [ -f /data/options.json ]; then
    # Use bashio to get configured release version
    export RELEASE=$(bashio::config "release")
    if [ $RELEASE = 'latest' ]; then
        /app/ring-mqtt/scripts/update2latest.sh
    elif [ $RELEASE = 'dev' ]; then
        /app/ring-mqtt/scripts/update2dev.sh
    fi
    echo "-------------------------------------------------------"
    echo "| Ring Device Integration via MQTT                    |"
    echo "| Addon for Hass.io                                   |"
    echo "|                                                     |"
    echo "| Report issues at:                                   |"
    echo "| https://github.com/tsightler/ring-mqtt-hassio-addon |"
    echo "-------------------------------------------------------"
    exec /app/ring-mqtt/scripts/run-addon.sh
else
    # No options.json found, assume we are in running in standard Docker
    set +o nounset
    if [ ! -z  ${DEBUG} ]; then
        echo "  ------------------------------------------"
        echo "  | Ring Devices to MQTT                   |"
        echo "  |                                        |"
        echo "  | Report issues at:                      |"
        echo "  | https://github.com/tsightler/ring-mqtt |"
        echo "  ------------------------------------------"
        echo -n "  ring-mqtt.js version: "
        echo $(cat /app/ring-mqtt/package.json | grep version | cut -f4 -d'"')
        echo "  ------------------------------------------"
    fi
    ISDOCKER=true exec /app/ring-mqtt/ring-mqtt.js
fi