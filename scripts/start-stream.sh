#!/bin/bash
# Script to activate live stream on Ring cameras via ring-mqtt
# Requires mosquitto MQTT clients package to be installed
# Provides status updates and termintates stream on exit or if stream 
# ends unexpectedly.  Primarily inteded for use with rtsp-simple-server
# to start and end stream on-demand.

# Required command line arguments
client_id=${1}            # This is the id used to connect to the MQTT broker. Can be anything but typically camera ID
client_name=${2}          # Friendly name of camera (used for logging)
json_attribute_topic=${3} # JSON attribute topic for Camera entity
command_topic=${4}        # Command topic for Camera entity

# Set some colors for debug output
red='\033[0;31m'
yellow='\033[0;33m'
green='\033[0;32m'
blue='\033[0;34m'
reset='\033[0m'

ctrl_c() {
    if [ -z ${reason} ]; then
        # If no reason defined, that means we were interrupted by a singnal, send the command to stop the live stream
        echo -e "${green}[${client_name}]${reset} Deactivating live stream due to signal from RTSP server (likely no more active streams)"
        mosquitto_pub -i "${client_id}_pub" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${command_topic}" -m "OFF"
    fi
    # Cheesy, but there should only ever be one process per client active at any time so this works for now
    mosquitto_pid=`ps -ef | grep mosquitto_sub | grep "${client_id}" | tr -s ' ' | cut -d ' ' -f2`
    [ ! -z ${mosquitto_pid} ] && kill ${mosquitto_pid}
    exit 0
}

# Trap signals so that the MQTT command to stop the stream can be published on exit
trap ctrl_c INT TERM QUIT

# This loop starts mosquitto_sub with a subscription on the camera stream topic that sends all received
# messages to a file descriptor which is read continously. On initial startup the script waits 100ms to
# publish the stream 'ON' command to the command topic.  All stream state messages received are processed
# based on the detailed states from the json_attributes_topic:
#
# "inactive" = There is no active live stream and none currently requested
# "activating" = A live stream has been requested and is in the process of starting
# "active" = The live stream started successfully and is currently in progress
# "failed" = A live stream was requested but failed to start
while read -u 10 message
do
    # If start message received, publish the command to start stream
    if [ ${message} = "START" ]; then
        echo -e "${green}[${client_name}]${reset} Activating live stream via topic ${blue}${command_topic}${reset}"
        mosquitto_pub -i "${client_id}_pub" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${command_topic}" -m "ON"
    else
        # Otherwise it should be a JSON message from the stream state attribute topic so extract the detailed stream state
        stream_state=`echo ${message} | jq -r '.streamState'`
        case ${stream_state,,} in
            activating)
                echo -e "${green}[${client_name}]${reset} Camera live stream is activating..."
                ;;
            active)
                echo -e "${green}[${client_name}]${reset} Camera live stream successfully activated!"
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
                echo -e "${green}[${client_name}]${red} ERROR - Unknown live stream state received on topic ${blue}${json_attribute_topic}${reset}"
                ;;
        esac
    fi
done 10< <(mosquitto_sub -q 1 -i "${client_id}_sub" -u "${MQTTUSER}" -P "${MQTTPASSWORD}" -h "${MQTTHOST}" -p "${MQTTPORT}" -t "${json_attribute_topic}" & (sleep .1; echo "START"))

ctrl_c
exit 0
