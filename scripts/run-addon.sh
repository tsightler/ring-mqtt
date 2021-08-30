#!/usr/bin/env bashio
if [ "${BRANCH}" = "latest" ]; then
    cd /app/ring-mqtt-latest
elif [ "${BRANCH}" = "dev" ]; then
    cd /app/ring-mqtt-dev
    echo "Adding mostquitto-clients..."
    apk add --no-cache mosquitto-clients
    echo "Downloading and installing rtsp-simple-server..."
    APKARCH="$(apk --print-arch)"
    mkdir -p bin; cd bin
    case "${APKARCH}" in
        'x86_64')
            wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_amd64.tar.gz
            ;;
        'aarch64')
            wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_arm64v8.tar.gz
            ;;
        'armv7')
            wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_armv7.tar.gz
            ;;
        'armhf')
            wget -O rtsp-simple-server.tar.gz https://raw.githubusercontent.com/tsightler/rtsp-simple-server/main/release-custom/rtsp-simple-server_v0.17.2-21-g43b10dc_linux_armv6.tar.gz
            ;;
        *) 
            echo >&2 "ERROR: Unsupported architecture '$APKARCH'"; 
            exit 1 
            ;;
    esac
    tar zxvfp rtsp-simple-server.tar.gz rtsp-simple-server
    rm rtsp-simple-server.tar.gz
    cd ..
    echo "-------------------------------------------------------"
    echo "Downloading and installing s6-overlay..."
        case "${APKARCH}" in
        'x86_64')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-amd64.tar.gz" | tar zxvf - -C /
            ;;
        'aarch64')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-aarch64.tar.gz" | tar zxvf - -C /
            ;;
        'armv7')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-arm.tar.gz" | tar zxvf - -C /
            ;;
        'armhf')
            curl -L -s "https://github.com/just-containers/s6-overlay/releases/download/v2.2.0.3/s6-overlay-armhf.tar.gz" | tar zxvf - -C /
            ;;
        *) 
            echo >&2 "ERROR: Unsupported architecture '$APKARCH'"; 
            exit 1 
            ;;
    esac
    mkdir -p /etc/fix-attrs.d
    mkdir -p /etc/services.d
else
    cd /app/ring-mqtt
fi
echo ring-mqtt.js version $(cat package.json | grep version | cut -f4 -d'"')
echo Node version $(node -v)
echo NPM version $(npm -v)
git --version
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
echo "Running ring-mqtt..."
if [ "${BRANCH}" = "latest" ]; then
    DEBUG=ring-mqtt ISADDON=true exec /app/ring-mqtt-latest/ring-mqtt.js
elif [ "${BRANCH}" = "dev" ]; then
    DEBUG=ring-* ISADDON=true exec /app/ring-mqtt-dev/ring-mqtt.js
else
    DEBUG=ring-mqtt ISADDON=true exec /app/ring-mqtt/ring-mqtt.js
fi
