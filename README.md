![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt/dev/images/ring-mqtt-logo.png)

### Description
The ring-mqtt project acts as a bridge between alarm, smart lighting and camera devices sold by Ring LLC and an MQTT broker thus allowing any automation tools that can leverage the open standards based MQTT protocol to monitor and control these devices.  The project also supports video streaming by providing an RTSP gateway service that allows any media client supporting the RTSP protocol to connect to a Ring camera livestream or to play back recorded events (Ring Protect subscription required for event recording playback).  Please review the full list of [supported devices and features](#supported-devices-and-features) for more information on current capabilities.

The code is written primarily in JavaScript and leverages the excellent [ring-client-api](https://github.com/dgreif/ring) for communicating with the same REST API used by the official Ring apps.  For video streaming ring-client-api establishes the RTP steam via a SIP session and forwards the packets to an FFmpeg which publishes the stream via RTSP to [rtsp-simple-server](https://github.com/aler9/rtsp-simple-server).  

Home Assistant style MQTT discovery is supported which allows for easy integration with minimal configuration (requires the Home Assistant Mosquitto/MQTT integration to be enabled).  For those using Home Assistant OS, or other supervised Home Assistant installations, there is a sister project providing a [Home Assistant Addon](https://github.com/tsightler/ring-mqtt-ha-addon) which allows installing Ring-MQTT directly via the native add-on store capabilities (not HACS).

## Installation
Docker is the recommended installation method.  While it's completely possible to install this code manually as a service on Linux, it requires manually satisfying pre-requisites, copying systemd unit files and registering the service, etc.  I do not test the standard install method so if you go with this method you are mostly on your own to solve problems with versions and dependencies. Note that this project supports only Linux platforms and will not run properly on Windows.  Please read the documentation for your preferred install method below for details on the require installation steps and configuration:

[Docker Install](docs/DOCKER.md)

[Standard Install](docs/STANDARD.md)

### Camera video stream configuration
Please read the detailed [camera documentation](docs/CAMERAS.md) for more information on video streaming configuration.

**!!!! Important note regarding camera support !!!!**    
The ring-mqtt project does not magically turn Ring cameras into 24x7/continuous streaming CCTV cameras.  Ring cameras are designed to work with Ring cloud servers for on-demand streaming based on detected events (motion/ding) or interactive viewing.  Even when using ring-mqtt, all streaming still goes through Ring cloud servers and is not local.  Attempting to leverage this project for continuous streaming is not a supported use case and attempts to do so will almost certainly end in disappointment, this includes use with NVR tools like Frigate or motionEye.

### Use with MQTT Tools other than Home Assistant (Node-Red, OpenHAB, etc.)
MQTT topics are built consistently during each startup.  The easiest way to determine the device topics is to run the script with debug output.  More details about the topic format for all devices is available in [docs/TOPICS.md](docs/TOPICS.md).

## Supported Devices and Features
- Full support for 2FA including embedded web based authentication app (addon and standalone installs only, Docker includes a simple CLI)
- Supports the following devices and features:
  - Alarm Devices
    - Alarm Control Panel
      - Arm/Disarm actions
      - Arm/Disarm commands are monitored for success and retried automatically
      - [Arm/Disarm arming bypass switch](#arming-bypass) (Allows arming with faulted contact sensors)
      - Alarm states:
        - Disarmed
        - Armed Home
        - Armed Away
        - Arming (exit delay) 
        - Pending (entry delay)
        - Triggered
      - Disarm code support for Home Assistant (optional)
    - Base Station
      - [Volume Control](#volume-control) (only when using Ring primary account)
      - Panic Switches (same as panic sliders in Ring app, Ring Protect Plan is required)
      - Siren Switch
    - Keypad
      - [Volume Control](#volume-control)
      - Battery level
      - AC/Charging state
    - Ring Contact and Motion Sensors
    - Ring Flood/Freeze Sensor
    - Ring Smoke/CO Listener
    - First Alert Z-Wave Smoke/CO Detector
    - Ring Retro Kit Zones
    - Ring Range Extender
    - Ring External Siren
    - 3rd party Z-wave door locks (Wifi based locks integrated via Amazon Key are **NOT** supported as they use a completely different API)
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
    - Lights (for capable devices)
    - Siren (for capable device)
    - [Snapshots](#snapshot-options) (images refresh on motion events or scheduled refresh interval).
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
    - Must be explicitly enabled using "enable_modes" config or ENABLEMODES environment variable
- Full Home Assistant MQTT discovery and device registry support - devices appear automatically
- Consistent topic creation based on location/device ID - easy to use with MQTT tools like Node-RED or other home automation platforms with MQTT support
- Support for multiple locations
- Monitors websocket connection to each alarm and sets reachability status if socket is unavailable (Home Assistant UI reports "unknown" status for unreachable devices), automatically resends device state when connection is established
- Monitors MQTT connection to trigger automatic resend of configuration and state data after restart/disconnect
- Monitors Home Assistant MQTT birth messages to trigger automatic resend of configuration and state data after Home Assistant restart
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Additional Feature Details
#### Snapshot Options
Ring-mqtt has the ability to take still image snapshots based on motion events or at specific intervals.  These images can be automatically displayed in many home automation platforms, such as Home Assistant, via a camera entity/device.  Please note that these are not live action as MQTT is limited in this regard, however, even these snapshots can be quite useful.  There are a few modes that can be enabled:

| Mode | Description |
| --- | --- |
| disabled | No snapshot images will be requested or sent |
| motion | Snapshots are refreshed only on detected motion events |
| interval | Snapshots are refreshed on scheduled interval only |
| all | Snapshots are refreshed on both scheduled and motion events, interval snapshots are paused during active motions events |

When snapshot support is enabled, the script always attempts to grab a snapshot on initial startup.

When interval mode is selected, snapshots of cameras with wired power supplies are taken every 30 seconds by default, for battery powered cameras taking a snapshot every 30 seconds leads to significant power drain so snapshots are taken only every 10 minutes, however, if the Ring Snapshot Capture feature is enabled, snapshots are instead taken at the frequency selected in the Ring app for this feature (minimum 5 minutes for battery powered cameras).  If interval mode is enabled the interval can be changed dynamically from 10 to 604,800 seconds (7 days).

Battery powered cameras have significant limitations with regard to their snapshot capabilities.  These limitation can impact both the speed and ability to acquire snapshots.  These cameras are unable to take snapshots while they are recording or live streaming.  Because of this, ring-mqtt attempts to detect cameras in battery powered mode and uses alternate methods to acquire snapshots from these cameras during detected motion events by starting a live stream and extracting a still frame directly from the stream.  This is of course slower than just taking a standard snapshot, so battery cameras usually take an additional 4-8 seconds before a motion snapshot is updated. 

#### Arming Bypass
By default, attempts to arm the alarm when any contact sensors are in faulted state will fail with an audible message from the base station that sensors require bypass. Arming will retry 5 times every 10 seconds giving time for doors/windows to be closed, however, if sensors still require bypass after this time, arming will fail.

Ring-mqtt exposes a switch labeled "Arming Bypass Mode" which can be toggled to change this arming behavior.  When this switch is "on", arming commands will automatically bypass any actively faulted contact sensors.  While this option always defaults to "off" on startup, if it is desired for the default state to always be "on" a simple automation can handle this case.

#### Location Limiting
By default, this script will discover and monitor enabled devices across all locations to which the specified account has access, even shared locations.  During startup all locations must be initially online or the script will wait forever until those locations are reachable.  To limit monitored locations it's possible to create a separate account and assign only the desired resources to it, or to pass the specific location IDs using the appropriate config option.  To get the location id from the Ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to `https://account.ring.com/account/dashboard?l=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` with the last path element being the location id (the id is after "?l=").

#### Volume Control
Volume Control is supported for Ring Keypads and Base Stations.  Note that Ring shared users do not have access to control the Base Station volume so, if you want to control the Base Station volume using this integration, you must generate the refresh token using the primary Ring account.  During startup the system attempts to detect if the account can control the base station volume and only shows the volume control if it determines the account has access.  This is a limitation of the Ring API as even the official Ring App does not offer volume control to shared users.

## Debugging
Debug output is controlled using the **DEBUG** environment variable and leverages the terrific [debug](https://www.npmjs.com/package/debug) package.  To get debug output simply set the **DEBUG** environment variable as appropriate.  The debug message categories and the corresponding output are described below:

| Category | Description |
| --- | --- |
| ring-mqtt | Startup messages and MQTT topic/state messages only for simple text based entity topics |
| ring-attr | MQTT topic/state message for JSON attribute topics |
| ring-disc | Full MQTT Home Assistant discovery messages (for large environments can be quite wordy during startup) |
| ring-rtsp | Messages from RTSP streaming server the video stream on-demand scripts |

The default debug output for the Docker image, as well as the Home Assistant addon, is all categories (`DEBUG=ring-*`) but it is possible to override this by explicitly setting the **DEBUG** environment variable.  For the standard installation, debug output is disabled by default.  Multiple debug categories can be selected by combining them with a comma or by using wildcards.  Below are some examples:

**Debug messages from both simple topics and attributes topics**\
`DEBUG=ring-mqtt,ring-attr`

**Enable all ring-mqtt specific debug messages (this is the most useful for debugging issues)**\
This option can also be useful when using the script with external MQTT tools as it dumps all discovered sensors and their topics and allows you to monitor sensor states in real-time on the console.  
`DEBUG=ring-*`

**Debug messages from ring-mqtt and all sub-modules** (Warning, this extremely verbose and rarely needed!)\
`DEBUG=*`

**Example for Docker**
```bash
docker run -it --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST=host_name" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" -e "DEBUG=ring-mqtt" tsightler/ring-mqtt
```

**Example for Standard Install**\
`DEBUG=ring-mqtt ./ring-mqtt`

## Thanks
Many thanks to @dgrief and his excellent [ring-client-api API](https://github.com/dgreif/ring/) as well as his homebridge plugin, from which I've learned a lot.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

Also, thanks to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for the original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
