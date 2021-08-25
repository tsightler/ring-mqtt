#!/bin/bash

CLIENT_NAME=${1}
STATE_TOPIC=${2}
COMMAND_TOPIC=${3}

mosquitto_pub -i "${CLIENT_NAME}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${COMMAND_TOPIC}" -m "ON"

mosquitto_sub -c -q 1 -i "${CLIENT_NAME}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${STATE_TOPIC}" | while read -r message
do
   echo "This is a great message: ${message}"
   if [ "${message}" = "OFF" ]; then
       echo "We really should exit...."
       mosquitto_pid=`ps -ef | grep mosquitto_sub | grep "${CLIENT_NAME}" | tr -s ' ' | cut -d ' ' -f2`
       echo "${mosquitto_pid}"
       kill ${mosquitto_pid}
       break
   fi
done

echo "We're out of the loop!"
exit
