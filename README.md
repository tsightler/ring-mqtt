# ring-mqtt
This script leverages the excellent [ring-client-api](https://github.com/dgreif/ring) to provide a bridge between MQTT and suppoted Ring devices such as alarm control panel, lights and cameras ([full list of supported devices and features](#current-features)).  It also provides support for Home Assistant style MQTT auto-discovery which allows for easy Home Assistant integration with minimal configuration (requires Home Assistant MQTT integration to be enabled).  This also includes an optional [Home Assistant Addon](https://github.com/tsightler/ring-mqtt-ha-addon) for users of HassOS/Home Assistant Installer.  It can also be used with any other tool capable of working with MQTT as it provides consistent topic naming based on location/device ID.

## !!! Important Notices - Please Read !!!
If you are upgrading from ring-mqtt prior to version 4.0.0, or from Home Assistant versions < 0.113, please read the approciate section in [docs/NOTICES.md](docs/NOTICES.md)
 
## Installation
Starting with the 4.0.0 release of ring-mqtt, Docker is now the recommended installation method, however, standard, non-Docker installation is still fully supported.  Please skip to the [Standard Install](#standard-install) section for details on this installation method.

### Docker Install
For Docker installtion details, please read this section entirely.  While it is possible to build the image locally from the included Dockerfile, it is recommended to install and update by pulling the official image directly from Docker Hub.  You can pull the image with the following command:
```
docker pull tsightler/ring-mqtt
```

Alternatively, you can issue "docker run" and Docker will automatically pull the image if it doesn't already exist locally (the command below is just an example, please see the [Environment Variables](#environment-variables) section for all available configuration options):
```
docker run --rm -e "MQTTHOST=host_name" -e "MQTTPORT=host_port" -e "MQTTRINGTOPIC=ring_topic" -e "MQTTHASSTOPIC=hass_topic" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" -e "ENABLECAMERAS=true-or-false" -e "RINGLOCATIONIDS=comma-separated_location_IDs" tsightler/ring-mqtt
```

#### Storing Updated Refresh Tokens
The Docker container supports the use of a bind mount to provide persistent storage.  While the Docker container will run without this storage, using the bind mount is highly recommended as, otherwise, it will likely be required to generate a new token each time the container starts since there is nowhere for the script to save renewed tokens which are typically generated every hour. For more details on acquiring an initial refresh token please see ([Authentication](#authentication)).

You can use any directory on the host for this persistent store, but it must be mounted to /data in the container.  The following is an example docker run command using a bind mount to mount the host directory /etc/ring-mqtt to the container path /data:
```
docker run --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST=host_name" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" tsightler/ring-mqtt
```

#### Environment Variables
Note that the only absolutely required parameter for initial start is **RINGTOKEN** but, in practice, at least **MQTTHOST** will likely be required as well, and **MQTTUSER/MQTTPASSWORD** will be required if the MQTT broker does not accept anonymous connections.  Default values for the environment values if they are not defined are as follows:

| Environment Variable Name | Description | Default |
| --- | --- | --- |
| RINGTOKEN | The refresh token received after authenticating with 2FA, see [Authentication](#authentication) section for details | blank - must be set for first run |
| MQTTHOST | Hostname for MQTT broker | localhost |
| MQTTPORT | Port number for MQTT broker | 1883 |
| MQTTUSER | Username for MQTT broker | blank - Use anonymous connection |
| MQTTPASSWORD | Password for MQTT broker | blank - Use anonymous connection |
| ENABLECAMERAS | Enable camera support, otherwise only alarm devices will be discovered | false |
| ENABLEMODES | Enable support for Location Modes for sites without a Ring Alarm Panel | false |
| ENABLEPANIC | Enable panic buttons on Alarm Control Panel device | false |
| ENABLEVOLUME | Enable volume control on Keypads and Base Station, see [Volume Control](#volume-control) for important information about this feature | false |
| RINGLOCATIONIDS | Array of location Ids in format: "loc-id","loc-id2", see [Limiting Locations](#limiting-locations) for details | blank |
| BRANCH | During startup pull latest master/dev branch from Github instead of running local copy, see [Branch Feature](#branch-feature) for details. | blank |

#### Starting the Docker container automatically during boot
To start the ring-mqtt docker container automatically during boot you can simply use the standard Docker methods, for example, adding ```--restart unless-stopped``` to the ```docker run``` command will cause Docker to automatically restart the container unless it has been explicitly stopped.

#### Branch Feature
The Docker image includes a feature that allows for easy, temporary testing of the latest code from the master or dev branch of ring-mqtt from Github, without requiring the installation of a new image.  This feature was designed to simplify testing of newer code for users of the addon, but Docker users can leverage it as well.  When running the Docker image normally the local image copy of ring-mqtt is used, however, sometimes the latest code in the Github repo master branch may be a few versions ahead, while waiting on the code to stabilize, or a user may need to test code in the dev branch to see if it corrects a reported issue.  This feature allows this to be done very easily without having to push or build a new Docker image.  To use this feature simple add the **BRANCH** environment variable as follows:
**BRANCH="latest"**
When this option is set, upon starting the Docker container the startup script will use git to fetch the lastest code from the master branch before running
**BRANCH="dev"**
When this option is set, upon starting the Docker container the startup script will use git to fetch the lastest code from the dev branch before running

To revert to the code in the Docker image simply run the container without the BRANCH setting.

### Standard Install
Stanard installation is fully supported, please make sure Node.js is installed (tested with 12.18.x but should work on 10.x and higher) on your system and then clone this repo:

`git clone https://github.com/tsightler/ring-mqtt.git`

Change to the ring-mqtt directory and run:

```
chmod +x ring-mqtt.js
npm install
```

This will install all required dependencies.  Edit config.js to configure your Ring refresh token and MQTT broker connection information and any other settings (see [Config Options](#config-options).  Note that the user the script runs as will need permission to write the config.json as, for the standalone version of the script, updated refresh tokens are written directly to the config.json file.

#### Config Options
| Config Option | Description | Default |
| --- | --- | --- |
| ring_token | The refresh token received after authenticating with 2FA, see [Authentication](#authentication) section for details | blank
| host | Hostname for MQTT broker | localhost |
| port | Port number for MQTT broker | 1883 |
| mqtt_user | Username for MQTT broker | blank |
| mqtt_pass | Password for MQTT broker | blank |
| enable_cameras | Enable camera support, otherwise only alarm devices will be discovered | false |
| enable_modes | Enable support for Location Modes for sites without a Ring Alarm Panel | false |
| enable_panic | Enable panic buttons on Alarm Control Panel device | false |
| enable_volume | Enable volume control on Keypad and Base Station.  See [Volume Control](#volume-control) for important information about this feature | false |
| location_ids | Array of location Ids in format: ["loc-id", "loc-id2"], see [Limiting Locations](#limiting-locations) for details | blank |

#### Starting ring-mqtt during boot
For standalone installs the repo includes a sample unit file which can be used to automaticlly start the script during system boot as long as your system uses systemd (most modern Linux distros).  The unit file assumes that the script is installed in /opt/ring-mqtt and it runs the script as the root user (to make sure it has permissions to write config.json), but you can easily modify this to any path and user you'd like.  Just edit the file as required and drop it in /lib/systemd/system then run the following:

```
systemctl daemon-reload
systemctl enable ring-mqtt
systemctl start ring-mqtt
```

## Configuration Details
### Authentication
Ring has made two factor authentication (2FA) mandatory thus the script now only supports this authentication method.  Using 2FA requires manually acquiring a refresh token for your Ring account and seting the ring_token parameter in the config file (standard/Hass.io installs) or passing the token with the RINGTOKEN environment variable (Docker installs).

There are two primary ways to acquire this token:

**Docker Installs**\
For Docker it is possible to use the bundled ring-client-api auth CLI to acquire a token for initial startup by executing the following:
```
docker run -it --rm --entrypoint /app/ring-mqtt/node_modules/ring-client-api/ring-auth-cli.js tsightler/ring-mqtt
```

**Standard Installs**\
For standard installs the script has an emedded web interface to make acquiring a token as simple as possible or you can manually acquire a token via the command line.

**Web Interface**\
If the script is started and the ring_token config parameter is empty, it will start a small web service at http://<ip_of_server>:55123.  Simply go to this URL with your browser, enter your username/password and then 2FA code, and it will display the Ring refresh token that you can just copy/paste into the config file.

**CLI Option**\
Use ring-auth-cli from the command line.  This command can be run from any system with NodeJS installed.  If you are using the standard installation method after running the "npm install" step you can execute the following from the ring-mqtt directory: 
```
npx -p ring-client-api ring-auth-cli
```

For more details please check the [Refresh Tokens](https://github.com/dgreif/ring/wiki/Refresh-Tokens) documentation from the ring client API Wiki.

**!!! Important Note regarding the security of your refresh token !!!**\
Using 2FA authentication opens up the possibility that, if the environment runinng ring-mqtt is comporomised, an attacker can acquire the refresh token and use this to authenticate to your Ring account without knowing your username/password and completely bypassing any 2FA protections.  Please secure your environment carefully.

Because of this added risk, it's a good idea to create a second account dedicated to use with ring-mqtt.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  Also, you can control what devices the script has access to and easily disable access if nafarious activity is detected.

### Limiting Locations
By default, this script will discover and monitor enabled devices across all locations, even shared locations for which you have permissions.  To limit monitored locations you can create a separate account and assign only the desired resources to it, or you can pass location_ids using the appropriate config option.  To get the location id from the ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to ```https://app.ring.com/location/{location_id}``` with the last path element being the location id.

### Volume Control
Volume Control for Ring Keypads and Base Stations is supported, however, starting with version 4.1.2 and later, volume control must be explicitly enabled using config options.  Note that Ring shared users do not have access to control the Base Station volume so, if you want to control the Base Station volume using this script, you must generate the refresh token using the primary Ring account.  During startup the system attempts to detect if the account can control the base station volume and only shows the volume control if it determines the accout has access.  This is a limitation of the Ring API as even the offical Ring App does not offer volume control to shared users.

**!!! Important Note about Volume Control in Home Assistant !!!**\
Due to the limitaitons of availabe MQTT integration components with Home Assistant, volume controls will appears as a "light" with brightness function.  The brighntess control is used to set the volume level while the turning the switch off immediate sets the volume to zero and turning the switch on sets the volume to 65%, although you can also turn the volume back on by setting the slider volume to any level other than zero.  Overall this works well, you can override icons to make it look reasonable in the Lovelace UI and automations can be used to set device volume based on time-of-day, alarm mode, etc, but this approach can have some unexpected side effects.  For example, if you have an automation that turns off all lights when you leave, this automation will likely also silence the volume on the keypad/base station because Home Assistant thinks it is a "light".  Be aware of these possible behaviors before enabling the volume control feature.

## Using with non-Home Assistant MQTT Tools (ex: Node Red)
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
      - Volume Control (if account has access to change volume and enabled)
    - Keypad
      - Volume Control (if enabled)
      - Battery level
      - AC/Charging state
    - Ring Contact and Motion Sensors
    - Ring Flood/Freeze Sensor
    - Ring Smoke/CO Listener
    - First Alert Z-Wave Smoke/CO Detector
    - Ring Retro Kit Zones
    - Ring integrated door locks (status and lock control)
    - Ring Range Extender
    - 3rd party Z-Wave switches, dimmers, and fans
    - 3rd party motion/contact/tilt sensors (basic support)
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
By default the script should produce no console output, however, the debug output is available by leveraging the terriffic [debug](https://www.npmjs.com/package/debug) package.  To get debug output simply set the DEBUG environment variable as appropriate on the run command.

**Debug messages from ring-mqtt only**\
This option is also useful when using the script with external MQTT tools as it dumps all discovered sensors and their topics.  Also allows you to monitor sensor states in real-time on the console.\
```DEBUG=ring-mqtt```

**Debug messages from all modules** (Warning, this very verbose!)\
```DEBUG=*```

**Example for Docker**\
```docker run -it --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST=host_name" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" -e "DEBUG=ring-mqtt" tsightler/ring-mqtt```

**Example for Standard Install**\
```DEBUG=ring-mqtt ./ring-mqtt```

## Thanks
Many thanks to @dgrief and his excellent [ring-client-api API](https://github.com/dgreif/ring/) as well as his homebridge plugin, from which I've learned a lot.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

Also thanks to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for his original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
