#!/command/with-contenv bashio

# =============================================================================
# ring-mqtt run script for s6-init               #
#
# This script automatically detects if it is running as the Home Assistant 
# addon or a standard docker environment and takes actions as appropriate 
# for the detected environment.
# ==============================================================================

# If HASSIO_TOKEN variable exist we are running as addon
if [ -v HASSIO_TOKEN ]; then
    RUNMODE_BANNER="Addon for Home Assistant     "
    # Use bashio to get configured branch
    export BRANCH=$(bashio::config "branch")
else
    RUNMODE_BANNER="Docker Edition               "
fi

# Short delay to keep log messages from overlapping with s6 logs
sleep .5

echo "-------------------------------------------------------"
echo "| Ring-MQTT with Video Streaming                      |"
echo "| ${RUNMODE_BANNER}                       |"
echo "|                                                     |"
echo "| For support questions please visit:                 |"
echo "| https://github.com/tsightler/ring-mqtt/discussions  |"
echo "-------------------------------------------------------"

if [ -v BRANCH ]; then
    if [ "${BRANCH}" = "latest" ] || [ "${BRANCH}" = "dev" ]; then
        /app/ring-mqtt/scripts/update2branch.sh
    fi
fi
