#!/usr/bin/env bashio

# If options.json exist we are running as addon
if [ -f /data/options.json ]; then
    # Use bashio to get configured release version
    export RELEASE=$(bashio::config "release")
    if [ $RELEASE = 'latest' ]; then
        exec /init/run-latest.sh
    elif [ $RELEASE = 'dev' ]; then
        exec /init/run-dev.sh
    else
        exec /init/run-prod.sh
    fi 
else
    # If there's no options.json assume we are in standard Docker container
    ISDOCKER=true exec /ring-mqtt/ring-mqtt.js
fi