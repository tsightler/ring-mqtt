#!/bin/bash
client_id=${1}
client_name=${2}
state_topic=${3}
command_topic=${4}
red=`tput setaf 1`
yellow=`tput setaf 3`
green=`tput setaf 2`
blue=`tput setaf 4`
cyan=`tput setaf 6`
reset=`tput sgr0`

ctrl_c() {
    if [ -z ${reason} ]; then 
        echo "Deactivating live stream for camera ${green}${client_name}${reset} due to signal from RTSP server (likely no active streams)"
        mosquitto_pub -i "${client_id}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${command_topic}" -m "OFF"
    fi
    # Cheesy, but there should only ever be one process per client active at any time so this works for now
    mosquitto_pid=`ps -ef | grep mosquitto_sub | grep "${client_id}" | tr -s ' ' | cut -d ' ' -f2`
    [ ! -z ${mosquitto_pid} ] && kill ${mosquitto_pid}
    exit 0
}

trap ctrl_c INT TERM QUIT

echo "Activating live stream for camera ${green}${client_name%:}${reset} via topic ${blue}${command_topic}${reset}"
mosquitto_pub -i "${client_id}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${command_topic}" -m "ON"

while read -u 10 message
do
    stream_state=`echo ${message} | jq -r '.streamState'`
    case ${stream_state,,} in
        activating)
            echo "Live stream for camera ${green}${client_name}${reset} has entered activating state"
            ;;
        active)
            echo "Live stream for camera ${green}${client_name}${reset} has been successfully activated"
            ;;
        inactive)
            echo "${yellow}Live stream for camera ${green}${client_name}${yellow} has gone inactive, exiting...${reset}"
            reason='inactive'
            ctrl_c
            ;;
        failed)
            echo "${red}ERROR - Live stream for camera ${green}${client_name%:}${red} failed to activate, exiting...${reset}"
            reason='failed'
            ctrl_c
            ;;
        *)
            echo "${red}ERROR - Received unknown stream state for camera ${green}${client_name%:}${red} on topic ${blue}${state_topic}${reset}"
            ;;
    esac
done 10< <( mosquitto_sub -q 1 -i "${client_id}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${state_topic}" )

ctrl_c
exit 0
