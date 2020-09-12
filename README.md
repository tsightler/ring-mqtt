# ring-mqtt
This script leverages the excellent [ring-client-api](https://github.com/dgreif/ring) to provide a bridge between MQTT and suppoted Ring devices such as alarm control panel, lights and cameras ([full list of supported devices and features](#current-features)).  It also provides support for Home Assistant style MQTT auto-discovery which allows for easy Home Assistant integration with minimal configuration (requires Home Assistant MQTT integration to be enabled).  This also includes an optional [Home Assistant Addon](https://github.com/tsightler/ring-mqtt-ha-addon) for users of HassOS/Home Assistant Installer.  It can also be used with any other tool capable of working with MQTT as it provides consistent topic naming based on location/device ID.

## !!! Important Changes for the 4.0.0 Release !!!
The primary goal of the 4.0.0 release was to improve supportability and reliability while also adding some long requested features.  Unfortunately the development of these capapabilities required introducing a few breaking changes.  Most of these changes will not impact Home Assistant users as they will be handled automatically but the MQTT discovery process however, if you were previously using the old JSON attribute topic to monitor battery levels or tamper status, you will need to modify those automations to use the new device level info sensor JSON topic which includes this information and much more.

For non-Home Assistant users, the topic levels have changed in this release to provide better consistency.  This new model is descibed in [docs/TOPICS.md](docs/TOPICS.md).

For a full list of changes and new features please see [docs/CHANGELOG.md](docs/CHANGELOG.md).

## !!! Important MQTT changes for Home Assistant >=0.113 !!!
Prior to Home Assistant 0.113 it was highly recommended to configure birth messages for the MQTT [component by manual settings](https://www.home-assistant.io/docs/mqtt/birth_will/) in configuration.yaml.  With this configuration ring-mqtt could monitor for restarts of the Home Assistant server and automatically resend devices and state updates after a restart.  In prior Home Assistant documentation, and prior versions of this script, the topic used was hass/status.

Home Assistant >=0.113 has now enabled birth/last will messages by default however, it uses the default topic of homeasssitant/status instead.  To comply with this new default behavior the config.json included with this script has been modified to use the homeassistant/status topic instead.  This means, for new installs, no special configuration should be needed to take advantage of this feature and state updates will happen automatically after Home Assistant restart.

For existing users who have implemented the previously recommended configuration, everything should continue to work without changes after the upgrade, however, for consistency with future configurations, it is now recommended to revert the Home Assistant MQTT configuraiton to defaults and modify the config.json file to change the hass_topic value from hass/status to homeassistant/status.  You can also completely switch to UI configuration for the MQTT component after making this change if you wish since the script no longer depends on any special configuration to monitor Home Assistant status.

## Docker Installation
With version 4.0.0 Docker is now the recommended install method.  While you're still welcome to build your own image from the included Dockerfile you can now install and update by pulling directly from Docker Hub:

```
docker pull tsightler/ring-mqtt
```

Or just run directly (Docker will automatically pull the image if it doesn't exist locally):

```
docker run --rm -e "MQTTHOST={host_name}" -e "MQTTPORT={host_port}" -e "MQTTRINGTOPIC={ring_topic}" -e "MQTTHASSTOPIC={hass_topic}" -e "MQTTUSER={mqtt_user}" -e "MQTTPASSWORD={mqtt_pw}" -e "RINGTOKEN={ring_refreshToken}" -e "ENABLECAMERAS={true-or-false}" -e "RINGLOCATIONIDS={comma-separated location IDs}" tsightler/ring-mqtt
```

The Docker build supports the use of a bind mount for persistent storage.  This location is used to store updated refresh tokens in a persistent fashion, and may be used for storing other state information in the future. While the use of persistent storage is not absolutely required, it is highly recommended as manually acquired refresh tokens will eventually expire and are renewed automatically by the script. Without persistent storage there is nowhere to save these renewed tokens so, on restart, you may have to manually acquire a new token again. Providing persistent storage to store these updated tokens will avoid this issue. For more details on acquiring an initial refresh token please see ([Authentication](#authentication)).

Here is an example docker run command with a bind mount which mount this host directory /etc/ring-mqtt to the container path /data:
```
docker run --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST={host_name}" -e "MQTTUSER={mqtt_user}" -e "MQTTPASSWORD={mqtt_pw}" -e "RINGTOKEN={ring_refreshToken}" tsightler/ring-mqtt
```
Note that the only absolutely required parameter for initial start is **RINGTOKEN** but, in practice, at least **MQTTHOST** will likely be required as well, and **MQTTUSER/MQTTPASSWORD** will be required if the MQTT broker does not accept anonymous connections.  Default values for the environment values if they are not defined are as follows:

| Environment Variable Name | Default |
| --- | --- |
| RINGTOKEN | blank - must be set for first run |
| MQTTHOST | localhost |
| MQTTPORT | 1883 |
| MQTTUSER | blank |
| MQTTPASSWORD | blank |
| ENABLECAMERAS | false |
| ENABLEMODES | false |
| ENABLEPANIC | false |
| RINGLOCATIONIDS | blank |
| BRANCH | blank |

When submitting any issue with the Docker build, please be sure to add '-e "DEBUG=ring-mqtt"' to the Docker run command before submitting.

## Branch Feature
The Docker image includes a feature that allows for easy, temporary testing of the latest code from the master or dev branch of ring-mqtt from Github, without requiring the installation of a new image.  This feature was designed to simplify testing of newer code for users of the addon, but Docker users can leverage it as well.  Normally, when running the Docker image, the local copy of ring-mqtt is used, however, sometimes the latest code in the Github repo master branch may be a few versions ahead, while waiting on the code to stabilize, or a user may need to test code in the dev branch to see if it corrects a reported issue.  This feature allows this to be done very easily.  To use this feature simple add the **BRANCH** environment variable as follows:
**BRANCH="latest"**
When this option is set, upon starting the Docker container the startup script will use git to fetch the lastest code from the master branch before running
**BRANCH="dev"**
When this option is set, upon starting the Docker container the startup script will use git to fetch the lastest code from the dev branch before running

To revert to the code in the Docker image simply run the container without the BRANCH setting.

## Standard Installation (Linux)
Stanard installation is still fully supported, please make sure Node.js is installed (tested with 12.18.x and higher) on your system and then clone this repo:

`git clone https://github.com/tsightler/ring-mqtt.git`

Change to the ring-mqtt directory and run:

```
chmod +x ring-mqtt.js
npm install
```

This will install all required dependencies.  Edit the config.js and configure your Ring refresh token and MQTT broker connection information.  Note that the user the script runs as will need permission to write the config.json as, for the standalone version of the script, updated refresh tokens are written directly to the config.json file.

### Starting the service automatically during boot
For Docker you can simply use the standard Docker methods for starting containers during boot or any other method for starting the container.

For standalone installs the repo includes a sample unit file which can be used to automaticlly start the script during system boot as long as your system uses systemd (most modern Linux distros).  The unit file assumes that the script is installed in /opt/ring-mqtt and it runs the script as the root user (to make sure it has permissions to write config.json), but you can easily modify this to any path and user you'd like.  Just edit the file as required and drop it in /lib/systemd/system then run the following:

```
systemctl daemon-reload
systemctl enable ring-mqtt
systemctl start ring-mqtt
```

## Authentication
Ring has made two factor authentication (2FA) mandatory thus the script now only supports this authentication method.  Using 2FA requires manually acquiring a refresh token for your Ring account and seting the ring_token parameter in the config file (standard/Hass.io installs) or passing the token with the RINGTOKEN environment variable (Docker installs).

There are two primary ways to acquire this token:

**Docker Installs**
For Docker it is possible to use the CLI to acquire a token for initial startup by executing the following:
```
docker run -it --rm --entrypoint node_modules/ring-client-api/ring-auth-cli.js tsightler/ring-mqtt
```

**Standard Installs** For standard installs the script as an emedded web interface to make acquiring a token as simple as possible or you can manually acquire a token via the command line.

**Web Interface**
If the script is started and the ring_token parameter is empty it will start a small web service at http://<ip_of_server>:55123.  Simply go to this URL with your browser, enter your username/password and then 2FA code, and it will display the Ring refresh token that you can just copy/paste into the config file.

**CLI Option** Use ring-auth-cli from the command line.  This command can be run from any system with NodeJS installed.  If you are using the standard Linux installation method after running the "npm install" step you can execute the following from the ring-mqtt directory: 
```
npx -p ring-client-api ring-auth-cli
```

For more details please check the [Refresh Tokens](https://github.com/dgreif/ring/wiki/Refresh-Tokens) documentation from the ring client API Wiki.

### ***Important Note regarding the security of your refresh token***
Using 2FA authentication opens up the possibility that, if your Home Assistant environment is comporomised, an attacker can acquire the refresh token and use this to authenticate to your Ring account without knowing your username/password and completely bypassing any 2FA protections.  Please secure your Home Assistant environment carefully.

Because of this added risk, it's a good idea to create a second account dedicated to this script.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  Also, you can control what devices the script has access to and easily disable access if nafarious activity is detected.

## Config Options
| Config Option | Description | Default |
| --- | --- | --- |
| ring_token | The refresh token received after authenticating with 2FA - See Authentication section | blank
| host | Hostname for MQTT broker | localhost |
| port | Port number for MQTT broker | 1883 |
| mqtt_user | Username for MQTT broker | blank |
| mqtt_pass | Password for MQTT broker | blank |
| enable_cameras | Enable camera support, otherwise only alarm devices will be discovered | false |
| enable_modes | Enable support for Location Modes for sites without a Ring Alarm Panel | false |
| enable_panic | Enable panic buttons on Alarm Control Panel device | false |
| location_ids | Array of location Ids in format: ["loc-id", "loc-id2"] | blank |

By default, this script will discover and monitor enabled devices across all locations, even shared locations for which you have permissions.  To limit locations you can create a separate account and assign only the desired resources to it, or you can pass location_ids using the appropriate config option.  To get the location id from the ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to ```https://app.ring.com/location/{location_id}``` with the last path element being the location id.

## Using with MQTT tools other than Home Assistant (ex: Node Red)

MQTT topics are built consistently during each startup.  The easiest way to determine the device topics is to run the script with debug output.  More details about the topic format for all devices is available in [docs/TOPICS.md](docs/TOPICS.md).

## Features and Plans
### Current features
- Full support for 2FA including embedded web service to simplfiy generation of refresh token
- Supports the following devices and features:
  - Alarm Devices
    - Alarm Control Panel
      - Arm/Disarm actions
      - Alarm states: 
        - Pending (entry delay)
        - Triggered
    - Base Station
      - Panic Buttons
      - Siren
      - Volume Control (if account has access to change volume)
    - Keypad
      - Volume Control
      - Battery level
      - AC/Charging state
    - Ring Contact and Motion Sensors
    - Ring Flood/Freeze Sensor
    - Ring Smoke/CO Listener
    - First Alert Z-Wave Smoke/CO Detector
    - Ring Retro Kit Zones
    - Ring integrated door locks (status and lock control)
    - 3rd party Z-Wave switches, dimmers, and fans
    - 3rd party motion/contact sensors (basic support)
    - Device info sensor with detailed state information such as (exact info varies by device):
      - Battery level
      - Tamper state
      - Communication status
      - Z-wave Link Quality
      - Serial Number
      - Firmware status
      - Device volume
  - Camera Devices
    - Motion Events
    - Doorbell (Ding) Events
    - Lights (for devices with lights)
    - Siren (for devices with siren support)
    - Device info sensor with detailed state information such as (exact info varies by device):
      - Wireless Signal/Info
      - Wired network status
      - Firmware Info
      - Latest communications status
  - Smart Lighting
    - Lighting and motion sensor devices
    - Light groups
    - Device info sensor with detailed state information (exact info varies by device)
  - Location Modes
    - For locations without a Ring Alarm, can add a panel for controlling camera settings via Ring Location Modes
    - Displays as an Alarm Panel in Home Assistant for setting modes and displaying mode state
    - Must be explicitly enabled using "enabled_modes" config or ENABLEMODES envrionment variable
- Full Home Assistant MQTT Discovery - devices appear automatically
- Full Home Assistant Device registry support - entities appear with parent device
- Consistent topic creation based on location/device ID - easy to use with MQTT tools like Node-RED
- Arm/Disarm commands are monitored for success and retried automatically
- Support for mulitple locations
- Monitors websocket connection to each alarm and sets reachability status if socket is unavailable (Home Assistant UI reports "unknown" status for unreachable devices), automatically resends device state when connection is established
- Monitors MQTT connection and Home Assistant MQTT birth messages to trigger automatic resend of configuration and state data after restart/disconnect
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Possible future features
- Arm/Disarm with code
- Arm/Disarm with sensor bypass
- Dynamic add/remove of alarms/devices (i.e. no service restart required)

## Debugging
By default the script should produce no console output, however, the script does leverage the terriffic [debug](https://www.npmjs.com/package/debug) package.  To get debug output, simply run the script like this:

**Debug messages from ring-mqtt only**
```
DEBUG=ring-mqtt ./ring-mqtt.js
```
This option is also useful when using the script with external MQTT tools as it dumps all discovered sensors and their topics.  Also allows you to monitor sensor states in real-time on the console.

**Debug messages from all modules** (Warning, this very verbose!)
```
DEBUG=* ./ring-mqtt.js
```

## Thanks
Many thanks to @dgrief and his excellent [ring-client-api API](https://github.com/dgreif/ring/) as well as his homebridge plugin, from which I've learned a lot.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

Also thanks to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for his original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
