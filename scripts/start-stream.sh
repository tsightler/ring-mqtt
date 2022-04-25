#!/bin/bash
# Activate video stream on Ring cameras via ring-mqtt
# Intended only for use as on-demand script for rtsp-simple-server
# Requires mosquitto MQTT clients package to be installed
# Uses ring-mqtt internal IPC broker for communications with main process 
# Provides status updates and termintates stream on script exit

# Required command line arguments
client_name=${1}   # Friendly name of camera (used for logging)
device_id=${2}     # Camera device Id
type=${3}          # Stream type ("live" or "event")
base_topic=${4}    # Command topic for Camera entity
client_id="${device_id}_${type}"  # Id used to connect to the MQTT broker, camera Id + event type
activated="false"

json_attribute_topic="${base_topic}stream/attributes"
command_topic="${base_topic}stream/command"

# Set some colors for debug output
red='\033[0;31m'
yellow='\033[0;33m'
green='\033[0;32m'
blue='\033[0;34m'
reset='\033[0m'

cleanup() {
    if [ -z ${reason} ]; then
        # If no reason defined, that means we were interrupted by a signal, send the command to stop the live stream
        echo -e "${green}[${client_name}]${reset} Deactivating ${type} stream due to signal from RTSP server (no more active clients or publisher ended stream)"
        mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${command_topic}" -m "OFF"
    fi
    # Kill the spawed mosquitto_sub process or it will stay listening forever
    kill $(pgrep -f "mosquitto_sub.*${client_id}_sub" | grep -v ^$$\$)
    exit 0
}

# Trap signals so that the MQTT command to stop the stream can be published on exit
trap cleanup INT TERM QUIT

# This loop starts mosquitto_sub with a subscription on the camera stream topic that sends all received
# messages via file descriptor to the read process. On initial startup the script publishes the message 
# 'ON-DEMAND' to the stream command topic which lets ring-mqtt know that an RTSP client has requested
# the stream.  Stream state is determined via the the detailed stream state messages received via the
# json_attributes_topic:
#
# "inactive" = There is no active video stream and none currently requested
# "activating" = A video stream has been requested and is initializing but has not yet started
# "active" = The stream was requested successfully and an active stream is currently in progress
# "failed" = A live stream was requested but failed to start
while read -u 10 message
do
    # If start message received, publish the command to start stream
    if [ ${message} = "START" ]; then
        echo -e "${green}[${client_name}]${reset} Requesting activation of ${type} stream via MQTT"
        mosquitto_pub -i "${client_id}_pub" -L "mqtt://127.0.0.1:51883/${command_topic}" -m "ON-DEMAND"
    else
        # Otherwise it should be a JSON message from the stream state attribute topic so extract the detailed stream state
        stream_state=`echo ${message} | jq -r '.status'`
        case ${stream_state,,} in
            activating)
                if [ ${activated} = "false" ]; then
                    echo -e "${green}[${client_name}]${reset} MQTT message indicates that ${type} stream is activating"
                fi
                ;;
            active)
                if [ ${activated} = "false" ]; then
                    echo -e "${green}[${client_name}]${reset} MQTT message indicates that ${type} stream is active"
                    activated="true"
                fi
                ;;
            inactive)
                echo -e "${green}[${client_name}]${yellow} MQTT message indicates that ${type} stream has gone inactive${reset}"
                reason='inactive'
                cleanup
                ;;
            failed)
                echo -e "${green}[${client_name}]${red} ERROR - MQTT message indicates that ${type} stream failed to activate${reset}"
                reason='failed'
                cleanup
                ;;
            *)
                echo -e "${green}[${client_name}]${red} ERROR - Unknown MQTT ${type} stream state received on topic ${blue}${json_attribute_topic}${reset}"
                ;;
        esac
    fi
done 10< <(mosquitto_sub -q 1 -i "${client_id}_sub" -L "mqtt://127.0.0.1:51883/${json_attribute_topic}" & echo "START"

cleanup
exit 0