#!/usr/bin/env bashio
echo "-------------------------------------------------------"
echo "| Ring Device Integration via MQTT (Production)       |"
echo "| Addon for Hass.io                                   |"
echo "|                                                     |"
echo "| Report issues at:                                   |"
echo "| https://github.com/tsightler/ring-mqtt-hassio-addon |"
echo "-------------------------------------------------------"
echo ring-mqtt.js version $(cat /ring-mqtt/package.json | grep version | cut -f4 -d'"')
echo Node version $(node -v)
echo NPM version $(npm -v)
git --version
echo "-------------------------------------------------------"
echo "Running \"npm audit fix\" to update packages with any vulnerabilities..."
cd /ring-mqtt
npm audit fix
chmod +x ring-mqtt.js
echo "-------------------------------------------------------"
# Setup the MQTT environment options based on addon configuration settings
export MQTTHOST=$(bashio::config "mqtt_host")
export MQTTPORT=$(bashio::config "mqtt_port")
export MQTTUSER=$(bashio::config "mqtt_user")
export MQTTPASSWORD=$(bashio::config "mqtt_password")

if [ $MQTTHOST = '<auto_detect>' ]; then
    if bashio::services.available 'mqtt'; then
        MQTTHOST=$(bashio::services mqtt "host")
	if [ $MQTTHOST = 'localhost' ] || [ $MQTTHOST = '127.0.0.1' ]; then
	    echo "Discovered invalid value for MQTT host: ${MQTTHOST}"
	    echo "Overriding with default alias for Mosquitto MQTT addon"
	    MQTTHOST="core-mosquitto"
	fi
        echo "Using discovered MQTT Host: ${MQTTHOST}"
    else
    	echo "No Home Assistant MQTT service found, using defaults"
        MQTTHOST="172.30.32.1"
        echo "Using default MQTT Host: ${MQTTHOST}"
    fi
else
    echo "Using configured MQTT Host: ${MQTTHOST}"
fi

if [ $MQTTPORT = '<auto_detect>' ]; then
    if bashio::services.available 'mqtt'; then
        MQTTPORT=$(bashio::services mqtt "port")
        echo "Using discovered MQTT Port: ${MQTTPORT}"
    else
        MQTTPORT="1883"
        echo "Using default MQTT Port: ${MQTTPORT}"
    fi
else
    echo "Using configured MQTT Port: ${MQTTPORT}"
fi

if [ $MQTTUSER = '<auto_detect>' ]; then
    if bashio::services.available 'mqtt'; then
        MQTTUSER=$(bashio::services mqtt "username")
        echo "Using discovered MQTT User: ${MQTTUSER}"
    else
        MQTTUSER=""
        echo "Using anonymous MQTT connection"
    fi
else
    echo "Using configured MQTT User: ${MQTTUSER}"
fi

if [ $MQTTPASSWORD = '<auto_detect>' ]; then
    if bashio::services.available 'mqtt'; then
        MQTTPASSWORD=$(bashio::services mqtt "password")
        echo "Using discovered MQTT password: <hidden>"
    else
        MQTTPASSWORD=""
    fi
else
    echo "Using configured MQTT password: <hidden>"
fi
echo "-------------------------------------------------------"
echo Running ring-mqtt...
chmod +x ring-mqtt.js
DEBUG=ring-mqtt HASSADDON=true exec /ring-mqtt/ring-mqtt.js