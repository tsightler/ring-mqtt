#!/bin/bash
client_id=${1}
client_name=${2}
state_topic=${3}
command_topic=${4}
red='\033[0;31m'
yellow='\033[0;33m'
green='\033[0;32m'
blue='\033[0;34m'
cyan='\033[0;36m'
reset='\033[0m'

ctrl_c() {
    if [ -z ${reason} ]; then 
        echo -e "${green}[${client_name}]${reset} Deactivating live stream due to signal from RTSP server (likely no more active streams)"
        mosquitto_pub -i "${client_id}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${command_topic}" -m "OFF"
    fi
    # Cheesy, but there should only ever be one process per client active at any time so this works for now
    mosquitto_pid=`ps -ef | grep mosquitto_sub | grep "${client_id}" | tr -s ' ' | cut -d ' ' -f2`
    [ ! -z ${mosquitto_pid} ] && kill ${mosquitto_pid}
    exit 0
}

trap ctrl_c INT TERM QUIT

echo -e "${green}[${client_name}]${reset} Activating live stream via topic ${blue}${command_topic}${reset}"
mosquitto_pub -i "${client_id}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${command_topic}" -m "ON"

while read -u 10 message
do
    stream_state=`echo ${message} | jq -r '.streamState'`
    case ${stream_state,,} in
        activating)
            echo -e "${green}[${client_name}]${reset} Camera live stream has succesfully entered activating state"
            ;;
        active)
            echo -e "${green}[${client_name}]${reset} Camera live stream has been successfully activated"
            ;;
        inactive)
            echo -e "${green}[${client_name}]${yellow} Camera live stream has gone inactive, exiting...${reset}"
            reason='inactive'
            ctrl_c
            ;;
        failed)
            echo -e "${green}[${client_name}]${red} ERROR - Camera live stream failed to activate, exiting...${reset}"
            reason='failed'
            ctrl_c
            ;;
        *)
            echo -e "${green}[${client_name}]${red} ERROR - Unknown live stream state received on topic ${blue}${state_topic}${reset}"
            ;;
    esac
done 10< <( mosquitto_sub -q 1 -i "${client_id}" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${state_topic}" )

ctrl_c
exit 0
