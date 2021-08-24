#!/bin/bash

CLIENT_NAME = ${1}
STATE_TOPIC = ${2}
COMMAND_TOPIC = ${3}

mosquitto_pub -i "${CLIENT_NAME}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${COMMAND_TOPIC}" -m "ON"

while true  # Keep an infinite loop to reconnect when connection lost/broker unavailable
do
    mosquitto_sub -c -q 1 -i "${CLIENT_NAME}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${COMMAND_TOPIC}" | while read -r message
    do
        # Here is the callback to execute whenever you receive a message:
        echo "Rx MQTT: ${message}"
    done
    sleep 10  # Wait 10 seconds until reconnection
done