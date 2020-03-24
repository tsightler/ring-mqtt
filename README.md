# ring-mqtt
This script leverages the excellent [ring-client-api](https://github.com/dgreif/ring) to provide a bridge between MQTT and suppoted Ring devices such as alarm control panel, lights and cameras ([full list of supported devices and features](#current-features)).  It also provides support for Home Assistant style MQTT discovery which allows for simple Home Assistant integration with minimal configuration (assuming MQTT is already configured), including an optional [Hass.io Addon](https://github.com/tsightler/ring-mqtt-hassio-addon) for users of that platform.  It can also be used with any other tool capable of working with MQTT as it provides consistent topic naming based on location/device ID.

## !!! Important note regarding Hass.io !!!
Due to the renaming of this project on Feb 20th, 2020, and the complete code refactor, old Hass.io addons developed for ring-alarm-mqtt will no longer work with this project.  As part of this release I have published a new [Hass.io addon](https://github.com/tsightler/ring-mqtt-hassio-addon) which I will attempt to support going forward.  Please migrate to it as soon as reasonable and report any issues with Hass.io there.

## Standard Installation (Linux)
Make sure Node.js (tested with 10.16.x and higher) is installed on your system and then clone this repo:

`git clone https://github.com/tsightler/ring-mqtt.git`

Change to the ring-mqtt directory and run:

```
chmod +x ring-mqtt.js
npm install
```

This will install all required dependencies.  Edit the config.js and enter your Ring account user/password and MQTT broker connection information.  You can also change the top level topic used for creating ring device topics as well as the Home Assistant state topic, but most people should leave these as default.

### Starting the service automatically during boot
I've included a sample service file which you can use to automaticlly start the script during system boot as long as your system uses systemd (most modern Linux distros).  The service file assumes you've installed the script in /opt/ring-mqtt and that you want to run the process as the homeassistant user, but you can easily modify this to any path and user you'd like.  Just edit the file as required and drop it in /lib/systemd/system then run the following:

```
systemctl daemon-reload
systemctl enable ring-mqtt
systemctl start ring-mqtt
```

## Docker Installation
Ring-mqtt is now on Docker Hub!  While you're still welcome to build your own image from the Dockerfile you can now install and update by pulling directly from Docker Hub:

```
docker pull tsightler/ring-mqtt
```

Or just run directly (Docker will automatically pull the image if it doesn't exist locally):

```
docker run --rm -e "MQTTHOST={host name}" -e "MQTTPORT={host port}" -e "MQTTRINGTOPIC={ring topic}" -e "MQTTHASSTOPIC={hass topic}" -e "MQTTUSER={mqtt user}" -e "MQTTPASSWORD={mqtt pw}" -e "RINGTOKEN={ring refreshToken}" -e "ENABLECAMERAS={true-or-false}" -e "RINGLOCATIONIDS={comma-separated location IDs}" tsightler/ring-mqtt
```
Note that only **RINGTOKEN** is technically required but in practice at least **MQTTHOST** will likely be required (unless you use the host network option in "docker run" command).  **MQTTUSER/MQTTPASSWORD** will be required if the MQTT broker does not accept anonymous connections.  Default values for the environment values if they are not defined are as follows:

| Environment Variable Name | Default |
| --- | --- |
| MQTTHOST | localhost |
| MQTTPORT | 1883 |
| MQTTRINGTOPIC | ring  |
| MQTTHASSTOPIC | hass/status |
| MQTTUSER | blank |
| MQTTPASSWORD | blank |
| ENABLECAMERAS | false |
| RINGLOCATIONIDS | blank |

When submitting any issue with the Docker build, please be sure to add '-e "DEBUG=ring-mqtt"' to the Docker run command before submitting.

## Authentication
Ring has made two factor authentication (2FA) mandatory thus the script now only supports this authentication method.  Using 2FA requires acquiring a refresh token for your Ring account and seting the ring_token parameter in the config file (standard/Hass.io installs) or passing the token with the RINGTOKEN environment variable (Docker installs).  There are two primary ways to acquire this token:

**Option 1:** Use ring-auth-cli from the command line.  This command can be run from any system with NodeJS installed.  If you are using the standard Linux installation method after running the "npm install" step you can execute the following from the ring-mqtt directory: 
```
node node_modules/ring-client-api/ring-auth-cli.js
```

   If you are using the Docker, you can execute:
```
docker run -it --rm --entrypoint node_modules/ring-client-api/ring-auth-cli.js tsightler/ring-mqtt
```
For more details please check the [Two Factor Auth](https://github.com/dgreif/ring/wiki/Two-Factor-Auth) documentation from the ring client API.

**Option 2:** This method is primarily for Hass.io, but also works with the standard script method (it does not work for the Docker method).  If you leave the ring_token parameter blank in the config file and run the script, it will detect that you don't yet have a refresh token and start a small web service at http://<ip_of_server>:55123.  Simply go to this URL with your browser, enter your username/password and then 2FA code, and it will display the Ring refresh token that you can just copy/paste into the config file.

For more details please check the [Two Factor Auth](https://github.com/dgreif/ring/wiki/Two-Factor-Auth) documentation from the ring client API.

### ***Important Node regarding your refresh token***
Using 2FA authenticaiton opens up the possibility that, if your Home Assistant or Hass.io environment is comporomised, an attacker can acquire the refresh token and use this to authenticate to your Ring account without knowing your username/password and completely bypassing the 2FA protections.  Please secure your Home Assistant environment carefully.

Because of this added risk, it's a good idea to create a second account dedicated to this script.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  Also, you can control what devices the script has access to and easily disable access if nafarious activity is detected.

## Config Options
| Config Option | Description | Default |
| --- | --- | --- |
| host | Hostname for MQTT broker | localhost |
| port | Port number for MQTT broker | 1883 |
| ring_topic | Top level topic for ring devices, default should be fine for most cases | ring |
| hass_topic | Home Assistant state topic, used to monitor for restarts to automatically republish devices | hass/status |
| mqtt_user | Username for MQTT broker | blank |
| mqtt_pass | Password for MQTT broker | blank |
| ring_token | The refresh token received after authenticating with 2FA - See Authentication section | blank
| enable_cameras | Enable camera support, otherwise only alarm devices will be discovered | false |
| location_ids | Array of location Ids in format: ["loc-id", "loc-id2"] | blank |

By default, this script will discover and monitor enabled devices across all locations, even shared locations for which you have permissions.  To limit locations you can create a separate account and assign only the desired resources to it, or you can pass location_ids using the appropriate config option.  To get the location id from the ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to ```https://app.ring.com/location/{location_id}``` with the last path element being the location id.

## Optional Home Assistant Configuration
**---Highly Recommended---**
For optimal operation with Home Assistant you should configure MQTT birth messages for Home Assistant.  Below is an example MQTT configuration with birth messages enabled.  See [here](https://www.home-assistant.io/docs/mqtt/birth_will/) for more information.
```
mqtt:
  birth_message:
    topic: 'hass/status'
    payload: 'online'
```

## Using with MQTT tools other than Home Assistant (ex: Node Red)

MQTT topics are built consistently during each startup.  The easiest way to determine the device topics is to run the script with debug output as noted below and it will dump the state and command topics for all devices, the general format for topics is as follows:

```
ring/<location_id>/alarm/<ha_platform_type>/<device_id>/<prefix>_state
ring/<location_id>/alarm/<ha_platform_type>/<device_id>/<prefix>_command
```

An example for the Smoke/CO listener:
```
ring/<location_id>/alarm/<ha_platform_type>/<device_id>/gas_state
ring/<location_id>/alarm/<ha_platform_type>/<device_id>/co_state

```

Or for a multi-level switch:
```
ring/<location_id>/alarm/switch/<device_id>/switch_state               <-- For on/off state
ring/<location_id>/alarm/switch/<device_id>/switch_brightness_state    <-- For brightness state
ring/<location_id>/alarm/switch/<device_id>/switch_command             <-- Set on/off state
ring/<location_id>/alarm/switch/<device_id>/switch_brightness_command  <-- Set brightness state

```

For cameras the overall structure is the same:
```
ring/<location_id>/camera/binary_sensor/<device_id>/ding_state      <-- Doorbell state
ring/<location_id>/camera/binary_sensor/<device_id>/motion_state    <-- Motion state
ring/<location_id>/camera/light/<device_id>/light_state             <-- Light on/off state
ring/<location_id>/camera/light/<device_id>/light_command           <-- Set light on/off state
ring/<location_id>/camera/switch/<device_id>/siren_state            <-- Siren state
ring/<location_id>/camera/switch/<device_id>/siren_command          <-- Set siren state
```

## Features and Plans
### Current features
- Full support for 2FA including embedded web service to simplfiy generation of refresh token
- Supports the following devices:
  - Alarm Devices
    - Alarm control panel (Monitor arming state + Arm/Disarm actions)
    - Ring Contact and Motion Sensors
    - Ring Flood/Freeze Sensor
    - Ring Smoke/CO Listener
    - First Alert Z-Wave Smoke/CO Detector
    - Ring Retro Kit Zones
    - Ring integrated door locks (status and lock control)
    - 3rd party Z-Wave switches, dimmers, and fans
  - Camera Devices
    - Motion Events
    - Doorbell (Ding) Events
    - Lights (for devices with lights)
    - Siren (for devices with siren support)
  - Smart Lighting
    - Lighting and motion sensor devices
    - Light groups
- Provides battery and tamper status for supported Alarm devices via JSON attribute topic (visible in Home Assistant UI)
- Full Home Assistant MQTT Discovery - devices appear automatically
- Consistent topic creation based on location/device ID - easy to use with MQTT tools like Node-RED
- Arm/Disarm commands are monitored for success and retried automatically
- Support for mulitple locations
- Monitors websocket connection to each alarm and sets reachability status if socket is unavailable (Home Assistant UI reports "unknown" status for unreachable devices), automatically resends device state when connection is established
- Monitors MQTT connection and Home Assistant MQTT birth messages ([if configured](#optional-home-assistant-configuration)) to trigger automatic resend of configuration data after restart/disconnect
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Planned features
- Support for additional 3rd party sensors/devices
- Additional Devices (base station, keypad - at least for tamper/battery status)

### Possible future features
- Base station settings (volume, chime)
- Arm/Disarm with code
- Arm/Disarm with sensor bypass
- Dynamic add/remove of alarms/devices (i.e. no service restart required)

## Debugging
By default the script should produce no console output, however, the script does leverage the terriffic [debug](https://www.npmjs.com/package/debug) package.  To get debug output, simply run the script like this:

**Debug messages from all modules** (Warning, this very verbose!)
```
DEBUG=* ./ring-mqtt.js
````

**Debug messages from ring-mqtt only**
```
DEBUG=ring-mqtt ./ring-mqtt.js
```
This option is also useful when using the script with external MQTT tools as it dumps all discovered sensors and their topics.  Also allows you to monitor sensor states in real-time on the console.

## Breaking changes in v3.0
The 3.0 release is a major refactor with the goal to dramatically simplfy the ability to add support for new devices and reduce complexity in the main code by implementing standardized devices functions.  Each device is now defined in it's own class, stored in separate files, and this class implements at least two standard methods, one for initializing the device (publish discovery message, subscribe to events and publish state updates) and a second for processing commands (only for devices that accept commands).  While this creates some code redundancy, it eliminates lots of ugly conditions and switch commands that were previously far too easy to break when adding new devices.

Also, rather than a single, global avaialbaility state for each location, each device now has a device specific availability topic.  Cameras track their own availability state by querying for device health data on a polling interval (60 seconds).  Alarms are still monitored by the state of the websocket connection for each location but, in the future, offline devices (such as devices with dead batteries or otherwise disconnected) will be monitored as well.

For those using this script with 3rd party MQTT tools (not Home Assistant) the state and command topics have been standardized to use consistent, Ring-like prefixes across topic names.  This way topic lengths for all devices are always the identical.  This makes internal processing in the code simpler and makes state and command topics consistent across both single and dual sensor devices.  For example, with 2.0 and earlier the state topic for the standaline co sensor would be:
```
ring/<location_id>/alarm/binary_sensor/<device_id>/state
```
While for the combined co/smoke listener it would be:
```
ring/<location_id>/alarm/binary_sensor/<device_id>/smoke/state
ring/<location_id>/alarm/binary_sensor/<device_id>/gas/state
```
This was inconsistent so now, with 3.0 the topics for the co sensor would be:
```
ring/<location_id>/alarm/binary_sensor/<device_id>/co_state
```
While for the combined device it will be
```
ring/<location_id>/alarm/binary_sensor/<device_id>/smoke_state
ring/<location_id>/alarm/binary_sensor/<device_id>/co_state

## Thanks
Many thanks to @dgrief and his excellent [ring-client-api API](https://github.com/dgreif/ring/) as well as his homebridge plugin, from which I've learned a lot.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

Also thanks to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for his original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
