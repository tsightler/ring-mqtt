# ring-mqtt
This script leverages the excellent [ring-client-api](https://github.com/dgreif/ring) to provide a bridge between MQTT and suppoted Ring devices such as alarm control panel, lights and cameras ([full list of supported devices and features](#current-features)).  It also provides support for Home Assistant style MQTT auto-discovery which allows for easy Home Assistant integration with minimal configuration (requires Home Assistant MQTT integration to be enabled).  This also includes an optional [Home Assistant Addon](https://github.com/tsightler/ring-mqtt-ha-addon) for users of HassOS/Home Assistant Installer.  It can also be used with any other tool capable of working with MQTT as it provides consistent topic naming based on location/device ID.
 
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
| ENABLECAMERAS | Default false since the native Ring component for Home Assistant supports cameras, set to true to enable camera/chime support in this add-on.  Access to Chimes cannot be granted to shared users so Chime support requires use of the primary Ring account. Also, this addon does **NOT** support live video, only snapshot images will be sent via the MQTT camera component) | false |
| SNAPSHOTMODE | Enable still snapshot image updates from camera, see [Snapshot Options](#snapshot-options) for details | 'disabled' |
| ENABLEMODES | Enable support for Location Modes for sites without a Ring Alarm Panel | false |
| ENABLEPANIC | Enable panic buttons on Alarm Control Panel device | false |
| BEAMDURATION | Set a default duration in seconds for Smart Lights when turned on via this integration.  The default value of 0 will attempt to detect the last used duration or default to 60 seconds for light groups.  This value can be overridden for individual lights using the duration feature but must be set before the light is turned on. | 0 |
| DISARMCODE | Used only with Home Assistant, when defined this option causes the Home Assistant Alarm Control Panel integration to require entering this code to disarm the alarm | blank |
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
| enable_cameras | Default false since the native Ring component for Home Assistant supports cameras, set to true to enable camera/chime support in this add-on.  Access to Chimes cannot be granted to shared users so Chime support requires use of the primary Ring account. Also, this addon does **NOT** support live video, only snapshot images will be sent via the MQTT camera component) | false |
| snapshot_mode | Enable still snapshot image updates from camera, see [Snapshot Options](#snapshot-options) for details | 'disabled' |
| enable_modes | Enable support for Location Modes for sites without a Ring Alarm Panel | false |
| enable_panic | Enable panic buttons on Alarm Control Panel device | false |
| beam_duration | Set a default duration in seconds for Smart Lights when turned on via this integration.  The default value of 0 will attempt to detect the last used duration or default to 60 seconds for light groups.  This value can be overridden for individual lights using the duration feature but must be set before the light is turned on. | 0 |
| disarm_code | Used only with Home Assistant, when defined this option causes the Home Assistant Alarm Control Panel integration to require entering this code to disarm the alarm | blank |
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
For Docker the easiest method to obtain the toke is to use the bundled ring-client-api auth CLI to acquire a token for initial startup by executing the following:
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

Because of this added risk, it's a good idea to create a second account dedicated to use with ring-mqtt and provide access to the devices you would like that account to be able to control.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  However, if do choose to use a secondary, shared account there are some limitations as Ring does not allow certain devices and functions to be granted access to shared accounts.  Because of this, support for Chimes, Smart Lighting groups, and Base Station volume control require the use of the primary Ring account.

### Arming Bypass
By default, attempts to arm the alarm when any contact sensors are in faulted state will fail with an audible message from the base station that sensors require bypass. Arming will retry 5 times evern 10 seconds giving time for doors/windows to be closed, however, if sensors still require bypass after this time, arming will fail.

Starting with version 4.4.0, ring-mqtt exposes an Arming Bypass Mode switch which can by toggled to change this arming behavior.  When this switch is "on", arming commands will automatically bypass any faulted contact sensors.  While this option always default to "off", if you prefer the default state to always be "on" you can create an automation to toggle it to "on" state any time it's detect as off.

### Limiting Locations
By default, this script will discover and monitor enabled devices across all locations, even shared locations for which you have permissions.  To limit monitored locations you can create a separate account and assign only the desired resources to it, or you can pass location_ids using the appropriate config option.  To get the location id from the ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to ```https://account.ring.com/account/dashboard?l=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx``` with the last path element being the location id (the id is after l=).

### Snapshot Options
Since ring-mqtt version 4.3 ring-mqtt has the ability to send still image snapshots.  These images will automatically display in many home automation platforms such as Home Assistant as a camera entity.  Please note that these are not live action as MQTT is limited in this regard, however, even these snapshots can be quite useful.  There are a few modes that can be enabled:

| Mode | Description |
| --- | --- |
| disabled | Snapshot images will be disabled |
| motion | Snapshots are refreshed only on detected motion events |
| interval | Snapshots are refreshed on scheduled interval only |
| all | Snapshots are refreshed on both scheduled and motion events, scheduled snapshots are paused during active motions events |

When snapshot support is enabled, the script always attempts to grab a snapshot on initial startup.

When interval mode is selected, snapshots of cameras with wired power supply are taken every 30 seconds by default, for battery powered cameras taking a snapshot every 30 seconds leads to signifcant power drain so snapshots are taken every 10 minutes, however, if the Ring Snapshot Capture feature is enabled, snapshots are instead taken at the frequency selected in the Ring app for this feature (minium 5 minutes for battery powere cameras).

It is also possible to manually override the snapshot interval, although the minimum time is 10 seconds.  Simply send the value in seconds to the ring/<location_id>/camera/<device_id>/snapshot/interval topic for the specific camera to override the default refresh interval.

### Volume Control
Volume Control is supported for Ring Keypads and Base Stations.  Note that Ring shared users do not have access to control the Base Station volume so, if you want to control the Base Station volume using this integration, you must generate the refresh token using the primary Ring account.  During startup the system attempts to detect if the account can control the base station volume and only shows the volume control if it determines the accout has access.  This is a limitation of the Ring API as even the offical Ring App does not offer volume control to shared users.

**!!! Important Note about Volume Control in Home Assistant !!!**\
Volume controls in Home Assistant now use the MQTT number integration so displaying values and changing them via the Lovelace UI or via automations is easy and no longer interacts with light based automations.

## Using with non-Home Assistant MQTT Tools (ex: Node Red)
MQTT topics are built consistently during each startup.  The easiest way to determine the device topics is to run the script with debug output.  More details about the topic format for all devices is available in [docs/TOPICS.md](docs/TOPICS.md).

## Features and Plans
### Current features
- Full support for 2FA including embedded web based authentication app (addon and standalone installs only)
- Supports the following devices and features:
  - Alarm Devices
    - Alarm Control Panel
      - Arm/Disarm actions
      - Arm/Disarm automatic bypass switch (Allows arming with faulted contact sensors)
      - Alarm states:
        - Disarmed
        - Armed Home
        - Armed Away
        - Arming (exit delay) 
        - Pending (entry delay)
        - Triggered
      - Disarm code support for Home Assistant (optional)
    - Base Station
      - Panic Switches (same as panic sliders in Ring app, Ring Protect Plan is required)
      - Siren Swich
      - Volume Control (if enabled and using Ring primary account)
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
    - Ring Range Extender
    - Ring External Siren
    - 3rd party Z-Wave switches, dimmers, and fans
    - 3rd party Z-Wave motion/contact/tilt sensors (basic support)
    - 3rd party Z-Wave thermostats and temperature sensors
    - Battery Level (for devices that support battery, detailed data in entity attributes)
    - Tamper Status (for devices that support tamper)
    - Device info sensor with detailed state information such as (exact info varies by device):
      - Battery level
      - Tamper state
      - Communication status
      - Z-wave Link Quality
      - Serial Number
      - Firmware status
      - Device volume
  - Ring Camera Devices
    - Motion Events
    - Doorbell (Ding) Events
    - Lights (for devices with lights)
    - Siren (for devices with siren support)
    - Camera Snapshots (images refresh on motion events or scheduled refresh interval).
      **Please note that live video is NOT supported by this addon and likely never will be due to the limitations of MQTT.**
    - Battery Level (detailed battery data such as charging status and aux battery state in attributes)
    - Wireless Signal in dBm (Wireless network in attributes)
    - Device info sensor with detailed state information such as (exact info varies by device):
      - Wireless Signal
      - Wired Network Name
      - Firmware Status
      - Last Update Status
  - Ring Chimes (requires using Ring primary account)
    - Volume Control
    - Play ding/motion sounds
    - Enter/Exit Snooze Mode
    - Set Snooze Minute (must be set prior to entering snooze state)
    - Wireless Signal in dBm (Wireless network in attributes)
    - Device info sensor with detailed state information such as (exact info varies by device):
      - Wireless Signal
      - Wired Network Name
      - Firmware Status
      - Last Update Status
  - Smart Lighting
    - Lighting and motion sensor devices
    - Light groups (requires using Ring primary account)
    - Device info sensor with detailed state information (exact info varies by device)
  - Location Modes
    - For locations without a Ring Alarm, can add a panel for controlling camera settings via Ring Location Modes
    - Displays as an Alarm Panel in Home Assistant for setting modes and displaying mode state
    - Must be explicitly enabled using "enabled_modes" config or ENABLEMODES envrionment variable
- Full Home Assistant MQTT discovery and device registry support - devices appear automatically
- Consistent topic creation based on location/device ID - easy to use with MQTT tools like Node-RED
- Arm/Disarm commands are monitored for success and retried automatically
- Support for mulitple locations
- Monitors websocket connection to each alarm and sets reachability status if socket is unavailable (Home Assistant UI reports "unknown" status for unreachable devices), automatically resends device state when connection is established
- Monitors MQTT connection and Home Assistant MQTT birth messages to trigger automatic resend of configuration and state data after restart/disconnect
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Possible future features
- Dynamic add/remove of alarms/devices (i.e. no service restart required)

## Debugging
By default the script should produce no console output, however, the debug output is available by leveraging the terrific [debug](https://www.npmjs.com/package/debug) package.  To get debug output simply set the DEBUG environment variable as appropriate on the run command.
**Note** Debugging output for ring-mqtt is enabled by default in Docker builds

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

Also thanks to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for the original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
