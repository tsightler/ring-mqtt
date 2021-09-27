![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt/dev/images/ring-mqtt-logo.png)

The ring-mqtt project acts as a bridge between alarm, smart lighting and camera devices sold by Ring LLC and an MQTT broker.  This allows any automation tools that can leverage the open standards based MQTT protocol to monitor and control these devices.  The project also supports video streaming by providing an RTSP gateway service that allows any media client supporting the RTSP protocol to connect to a Ring camera livestream or play back recorded events (Ring Protect subscription required for event recording playback).  Please review the full list of [supported devices and features](#current-features) for more information on current capabilities.

The code is written primarily in Javascript and leverages the excellent [ring-client-api](https://github.com/dgreif/ring) for communicating with the same REST API used by the official Ring apps.  For video streaming ring-client-api establishes the RTP steam via a SIP session and forwards the packets to an FFmpeg which publishes the stream via RTSP to [rtsp-simple-server](https://github.com/aler9/rtsp-simple-server).  

Home Assistant style MQTT discovery is supported which allows for easy integration with minimal configuration (requires the Home Assistant Mosquitto/MQTT integration to be enabled).  For those using Home Assistant OS, or other supervised Home Assistant installations, there is a sister project providding a [Home Assistant Addon](https://github.com/tsightler/ring-mqtt-ha-addon) which allows installing Ring-MQTT directly via the native add-on store capabilities (not HACS).

## Installation
Starting with the 4.0.0 release of ring-mqtt, Docker is the recommended installation method, however, standard, non-Docker installation is still fully supported.  Please skip to the [Standard Install](#standard-install) section for details on this install method.

### Docker Install
For Docker installation details, please read this section entirely.  While it is possible to build the image locally from the included Dockerfile, it is recommended to install and update by pulling the official image directly from Docker Hub.  You can pull the image with the following command:
```
docker pull tsightler/ring-mqtt
```

Alternatively, you can issue "docker run" and Docker will automatically pull the image if it doesn't already exist locally (the command below is just an example, please see the [Environment Variables](#environment-variables) section for all available configuration options):
```
docker run --rm -e "MQTTHOST=host_name" -e "MQTTPORT=host_port" -e "MQTTRINGTOPIC=ring_topic" -e "MQTTHASSTOPIC=hass_topic" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" -e "ENABLECAMERAS=true-or-false" -e "RINGLOCATIONIDS=comma-separated_location_IDs" tsightler/ring-mqtt
```

Note that Docker Compose also works well if you prefer this approach vs passing a large number of command line variables.

#### Storing Updated Refresh Tokens
The Docker container uses a bind mount to provide persistent storage.  While the Docker container will run without this storage, using the bind mount is highly recommended as, otherwise, it will sometimes be required to generate a new token when the container restarts since tokens eventually expire and there will be no way for an updated token to be stored in a persistent fashion. For more details on acquiring an initial refresh token please see ([Authentication](#authentication)).

You can use any directory on the host for this persistent store, but it must be mounted to /data in the container.  The following is an example docker run command using a bind mount to mount the host directory /etc/ring-mqtt to the container path /data:
```
docker run --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST=host_name" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" tsightler/ring-mqtt
```

#### Environment Variables
The only absolutely required parameter for initial startup is **RINGTOKEN** but, in practice, at least **MQTTHOST** will likely be required as well, and **MQTTUSER/MQTTPASSWORD** will be required if the MQTT broker does not accept anonymous connections.  Default values for the environment values if they are not defined are as follows:

| Environment Variable Name | Description | Default |
| --- | --- | --- |
| RINGTOKEN | The refresh token received after authenticating with 2FA, see [Authentication](#authentication) section for details | blank - must be set for first run |
| MQTTHOST | Hostname for MQTT broker | localhost |
| MQTTPORT | Port number for MQTT broker | 1883 |
| MQTTUSER | Username for MQTT broker | blank - Use anonymous connection |
| MQTTPASSWORD | Password for MQTT broker | blank - Use anonymous connection |
| ENABLECAMERAS | Default false since the native Ring component for Home Assistant supports cameras, set to true to enable camera/chime support in this add-on.  Access to Chimes cannot be granted to shared users so Chime support requires use of the primary Ring account. | false |
| SNAPSHOTMODE | Enable still snapshot image updates from camera, see [Snapshot Options](#snapshot-options) for details | 'disabled' |
| LIVESTREAMUSER | Specifiy a password for RTSP connections.  Highly recommended if the RTSP port for external media player access is enabled.  The livestream_password option must also be defined or this option is ignored. | blank |
| LIVESTREAMPASSWORD | Specifiy a password for RTSP connections.  Highly recommended if the RTSP port for external media player access is enabled.  The livestream_user option must also be defined or this option is ignored. | blank |
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
Stanard installation is supported but use of the Docker install method is highly recommended since the Docker image includes fully tested pre-requisites within the image.  Note that, for the most part, this code will run on any NodeJS version from v12 or later, however, video streaming support requires at least NodeJS 14.17.0 to function properly.

#### Video Streaming Pre-requisites
While the standard functionality in ring-mqtt requires just NodeJS and 
- NodeJS version must be at least 14.17.0 (latest LTS is recommended)
- [rtsp-simple-server](https://github.com/aler9/rtsp-simple-server) 0.17.3 or later must be installed and available in the system path
- The mosquitto clients package (mosquitto_sub/mosquitto_pub) must be available in the system path

Once the pre-requisites have been met simply clone this project from Github into a directory of your choice (the included systemd unit file below assumes /opt but can be easily modified):

`git clone https://github.com/tsightler/ring-mqtt.git`

Then switch to the ring-mqtt directory and run:

```
chmod +x ring-mqtt.js
npm install
```

This will install all of the required node dependencies.  Now edit the config.js file to configure your Ring refresh token and MQTT broker connection information and any other settings (see [Config Options](#config-options).  Note that the user the script runs as will need permission to write the config.json file as, for the standalone installation, updated refresh tokens are written back directly to the config.json file.

#### Config Options
| Config Option | Description | Default |
| --- | --- | --- |
| ring_token | The refresh token received after authenticating with 2FA, see [Authentication](#authentication) section for details | blank
| host | Hostname for MQTT broker | localhost |
| port | Port number for MQTT broker | 1883 |
| mqtt_user | Username for MQTT broker | blank |
| mqtt_pass | Password for MQTT broker | blank |
| enable_cameras | Default false since the native Ring component for Home Assistant supports cameras, set to true to enable camera/chime support in this add-on.  Access to Chimes cannot be granted to shared users so Chime support requires use of the primary Ring account. | false |
| snapshot_mode | Enable still snapshot image updates from camera, see [Snapshot Options](#snapshot-options) for details | 'disabled' |
| livestream_user | Specifiy a password for RTSP connections.  Highly recommended if the RTSP port for external media player access is enabled.  The livestream_password option must also be defined or this option is ignored. | blank |
| livestream_pass | Specifiy a password for RTSP connections.  Highly recommended if the RTSP port for external media player access is enabled.  The livestream_user option must also be defined or this option is ignored. | blank |
| enable_modes | Enable support for Location Modes for sites without a Ring Alarm Panel | false |
| enable_panic | Enable panic buttons on Alarm Control Panel device | false |
| beam_duration | Set a default duration in seconds for Smart Lights when turned on via this integration.  The default value of 0 will attempt to detect the last used duration or default to 60 seconds for light groups.  This value can be overridden for individual lights using the duration feature but must be set before the light is turned on. | 0 |
| disarm_code | Used only with Home Assistant, when defined this option causes the Home Assistant Alarm Control Panel integration to require entering this code to disarm the alarm | blank |
| location_ids | Array of location Ids in format: ["loc-id", "loc-id2"], see [Limiting Locations](#limiting-locations) for details | blank |

#### Starting ring-mqtt during boot
For standalone installs the repo includes a sample systemd unit file, named ring-mqtt.service and located in the ring-mqtt/init/systemd folder, which can be used to automaticlly start the script during system boot.  The unit file assumes that the script is installed in /opt/ring-mqtt and it runs the script as the root user (to make sure it has permissions to write config.json), but you can easily modify this to any path and user you'd like.  Just edit the file as required and drop it in /lib/systemd/system then run the following:

```
systemctl daemon-reload
systemctl enable ring-mqtt
systemctl start ring-mqtt
```

## Configuration Details
### Authentication
Ring has made two factor authentication (2FA) mandatory thus the script now only supports this authentication method.  Using 2FA requires manually acquiring a refresh token for your Ring account and passing the token with the RINGTOKEN environment variable (Docker installs) or setting the ring_token parameter in the config file (standard installs).

There are two primary ways to acquire this token:

**Docker Installs**\
For Docker the easiest method to obtain the token is to use the bundled ring-client-api auth CLI to acquire a token for initial startup by executing the following:
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
Using 2FA authentication opens up the possibility that, if the environment runinng ring-mqtt is comporomised, an attacker can acquire the refresh token and use this to authenticate to your Ring account without knowing your username/password and completely bypassing the standard 2FA protections.  Please secure your environment carefully.

Because of this added risk, it can be a good idea to create a second account dedicated for use with ring-mqtt and provide access to the devices you would like that account to be able to control.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  However, if do choose to use a secondary, shared account there are some limitations as Ring does not allow certain devices and functions to be granted access to shared accounts.  When using a secondary account support for Chimes, Smart Lighting groups, and Base Station volume control will not function.

### Camera video stream support
Please read the detailed [camera documentation](docs/CAMERAS.md) for more information on configuring video streaming.

#### External RTSP Server Access
When using the camera support for video streaming the Docker container will also run a local instance of rtsp-simple-server.  If your streaming platform runs on the same host you can usually just access directly via the Docker network, however, if you want to access the stream from other host on the network you can expose the RTSP port during startup as well.  Note that, if you choose to export the port, it is HIGHLY recommended to set a live stream user and password using the appropriate configuration options.

To expose the RTSP port externally simple add the standard Docker port options to your run command, something like "-p 8554:8554" would allow external media player clients to access the RTSP server on TCP port 8554.

### Arming Bypass
By default, attempts to arm the alarm when any contact sensors are in faulted state will fail with an audible message from the base station that sensors require bypass. Arming will retry 5 times evern 10 seconds giving time for doors/windows to be closed, however, if sensors still require bypass after this time, arming will fail.

Starting with version 4.4.0, ring-mqtt exposes an Arming Bypass Mode switch which can be toggled to change this arming behavior.  When this switch is "on", arming commands will automatically bypass any faulted contact sensors.  While this option always defaults to "off" on startup, if it is desired for the default state to always be "on" a simple automation can handle this case.

### Limiting Locations
By default, this script will discover and monitor enabled devices across all locations top which the specified accout has access, even shared locations.  During startup all locations must be initially online or the script will wait forever until those locations are reachable.  To limit monitored locations it's possible to create a separate account and assign only the desired resources to it, or to pass the specific location IDs using the appropriate config option.  To get the location id from the Ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to ```https://account.ring.com/account/dashboard?l=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx``` with the last path element being the location id (the id is after "?l=").

### Snapshot Options
Since ring-mqtt version 4.3 ring-mqtt has the ability to send still image snapshots.  These images can be automatically displayed in many home automation platforms such as Home Assistant as a camera entity.  Please note that these are not live action as MQTT is limited in this regard, however, even these snapshots can be quite useful.  There are a few modes that can be enabled:

| Mode | Description |
| --- | --- |
| disabled | No snapshot images will be requested or sent |
| motion | Snapshots are refreshed only on detected motion events |
| interval | Snapshots are refreshed on scheduled interval only |
| all | Snapshots are refreshed on both scheduled and motion events, interval snapshots are paused during active motions events |

When snapshot support is enabled, the script always attempts to grab a snapshot on initial startup.

When interval mode is selected, snapshots of cameras with wired power supply are taken every 30 seconds by default, for battery powered cameras taking a snapshot every 30 seconds leads to signifcant power drain so snapshots are taken every 10 minutes, however, if the Ring Snapshot Capture feature is enabled, snapshots are instead taken at the frequency selected in the Ring app for this feature (minium 5 minutes for battery powere cameras).  If interval mode is enabled the interval can be changed dynamically from 10 to 604,800 seconds (7 days).

Battery powered cameras have significant limitations with their snapshot capabilities that can impact both the speed and ability to acquire snapshots.  These cameras are unable to take snapshots while they are recording/streaming.  Because of this, ring-mqtt attempts to detect cameras in battery powered mode and uses alternate methods to acquire snapshots from these cameras during detected motion events by starting a live stream and capturing a snapshot directly from the stream.  This is of course slower than just taking a standard snapshot, so battery cameras usually take an additional 4-8 seconds before a motion snapshot is updated. 

### Volume Control
Volume Control is supported for Ring Keypads and Base Stations.  Note that Ring shared users do not have access to control the Base Station volume so, if you want to control the Base Station volume using this integration, you must generate the refresh token using the primary Ring account.  During startup the system attempts to detect if the account can control the base station volume and only shows the volume control if it determines the accout has access.  This is a limitation of the Ring API as even the offical Ring App does not offer volume control to shared users.

## Using with non-Home Assistant MQTT Tools (ex: Node Red)
MQTT topics are built consistently during each startup.  The easiest way to determine the device topics is to run the script with debug output.  More details about the topic format for all devices is available in [docs/TOPICS.md](docs/TOPICS.md).

## Features and Plans
### Current features
- Full support for 2FA including embedded web based authentication app (addon and standalone installs only)
- Supports the following devices and features:
  - Alarm Devices
    - Alarm Control Panel
      - Arm/Disarm actions
      - Arm/Disarm commands are monitored for success and retried automatically
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
    - Ring Range Extender
    - Ring External Siren
    - 3rd party Z-wave door locks (Wifi based locks integrated via Amazon Key are **NOT** supported)
    - 3rd party Z-Wave switches, dimmers, and fans
    - 3rd party Z-Wave motion/contact/tilt sensors (basic support)
    - 3rd party Z-Wave thermostats and temperature sensors
    - 3rd party Z-Wave sirens
    - Battery Level (for devices that support battery, detailed data in entity attributes)
    - Tamper Status (for devices that support tamper)
    - Device info sensor with detailed state information such as (exact info varies by device):
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
    - Snapshots (images refresh on motion events or scheduled refresh interval).
    - Live video streams via RTSP (streams start on-demand or can also be started via MQTT, for example to record based on events from other devices)
    - Recorded event streams via RTSP (playback of last 5 motion/ding recorded events selected via MQTT)
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
    - For locations without a Ring Alarm, can add a security panel style device for controlling camera settings via Ring Location Modes feature
    - Displays as an Alarm Panel in Home Assistant for setting modes and displaying mode state
    - Must be explicitly enabled using "enable_modes" config or ENABLEMODES envrionment variable
- Full Home Assistant MQTT discovery and device registry support - devices appear automatically
- Consistent topic creation based on location/device ID - easy to use with MQTT tools like Node-RED
- Support for mulitple locations
- Monitors websocket connection to each alarm and sets reachability status if socket is unavailable (Home Assistant UI reports "unknown" status for unreachable devices), automatically resends device state when connection is established
- Monitors MQTT connection and Home Assistant MQTT birth messages to trigger automatic resend of configuration and state data after restart/disconnect
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Possible future features
- Dynamic add/remove of alarms/devices (i.e. no service restart required)

## Debugging
By default the Docker and Home Assistant Addon produce significate debugging output, while the standard install produces very limited output at all.  Debug output is controlled using the DEBUG enviornment variable and leverages the terrific [debug](https://www.npmjs.com/package/debug) package.  To get debug output simply set the DEBUG environment variable as appropriate.

The following debug options and the logging output are described below:

DEBUG=ring-mqtt - Startup messages and MQTT topic/state messages only for simple text based entity topics
DEBUG=ring-attr - MQTT topic/state message for JSON attribute topics
DEBUG=ring-disc - Full MQTT Home Assistant discovery messages (for large environments can be quite wordy during startup)
DEBUG=ring-rtsp - Messages from RTSP streaming server the video stream on-demand scripts 

Multiple debug options can be selected by combined with a comma or by using wildcards.  Below are some examples:

**Debug messages from both simple topics and attributes topics**\
```DEBUG=ring-mqtt,ring-attr```

**Enable all ring-mqtt specific debug messages (this is the most useful for debugging issues)**\
This option can also be useful when using the script with external MQTT tools as it dumps all discovered sensors and their topics and allows you to monitor sensor states in real-time on the console.\
```DEBUG=ring-*```

**Debug messages from all modules used by ring-mqtt** (Warning, this very verbose and rarely needed!)\
```DEBUG=*```

**Example for Docker**\
```docker run -it --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST=host_name" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" -e "DEBUG=ring-mqtt" tsightler/ring-mqtt```

**Example for Standard Install**\
```DEBUG=ring-mqtt ./ring-mqtt```

## Thanks
Many thanks to @dgrief and his excellent [ring-client-api API](https://github.com/dgreif/ring/) as well as his homebridge plugin, from which I've learned a lot.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

Also, thanks to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for the original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
