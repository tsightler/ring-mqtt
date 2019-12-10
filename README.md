# ring-alarm-mqtt
This is a simple script that leverages the ring alarm API available at [dgreif/ring-alarm](https://github.com/dgreif/ring-alarm) and provides access to the alarm control panel and sensors via MQTT.  It provides support for Home Assistant style MQTT discovery which allows for very easy integration with Home Assistant with near zero configuration (assuming MQTT is already configured).  It can also be used with any other tool capable of working with MQTT as it provides consistent topic naming based on location/device ID.

### Standard Installation (Linux)
Make sure Node.js (tested with 8.x and higher) is installed on your system and then clone this repo:

`git clone https://github.com/tsightler/ring-alarm-mqtt.git`

Change to the ring-alarm-mqtt directory and run:

```
chmod +x ring-alarm-mqtt.js
npm install
```

This should install all required dependencies.  Edit the config.js and enter your Ring account user/password and MQTT broker connection information.  You can also change the top level topic used for creating ring device topics and also configre the Home Assistant state topic, but most people should leave these as default.

### Starting the service automatically during boot
I've included a sample service file which you can use to automaticlly start the script during system boot as long as your system uses systemd (most modern Linux distros).  The service file assumes you've installed the script in /opt/ring-alarm-mqtt and that you want to run the process as the homeassistant user, but you can easily modify this to any path and user you'd like.  Just edit the file as required and drop it in /lib/systemd/system then run the following:

```
systemctl enable ring-alarm-mqtt
```

### Docker Installation

To build, execute

```
docker build -t ring-alarm-mqtt/ring-alarm-mqtt .
```

To run, execute

```
docker run  -e "MQTTHOST={host name}" -e "MQTTPORT={host port}" -e "MQTTRINGTOPIC={host ring topic}" -e "MQTTHASSTOPIC={host hass topic}" -e "MQTTUSER={mqtt user}" -e "MQTTPASSWORD={mqtt pw}" -e "RINGUSER={ring user}" -e "RINGPASS={ring pq}" ring-alarm-mqtt/ring-alarm-mqtt
```

### Config Options
By default, this script will discover and monitor alarms across all locations, even shared locations for which you have permissions, however, it is possible to limit the locations monitored by the script including specific location IDs in the config as follows:

```"location_ids": ["loc-id", "loc-id2"]```.

To get the location id from the ring website simply login to [Ring.com](https://ring.com/users/sign_in) and look at the address bar in the browser. It will look similar to ```https://app.ring.com/location/{location_id}``` with the last path element being the location id.

Now you should just execute the script and devices should show up automatically in Home Assistant within a few seconds.

### Optional Home Assistant Configuration (Highly Recommended)
If you'd like to take full advantage of the Home Assistant specific features (auto MQTT discovery and server state monitorting) you need to make sure Home Assistant MQTT is configured with discovery and birth message options, here's an example:
```
mqtt:
  broker: 127.0.0.1
  discovery: true
  discovery_prefix: homeassistant
  birth_message:
    topic: 'hass/status'
    payload: 'online'
    qos: 0
    retain: false
```

Contact sensors have a default device class of `door`. Adding `window` to the contact sensor name will change the device class to `window`.

### Using with MQTT tools other than Home Assistant (ex: Node Red)
**----------IMPORTANT NOTE----------**

Starting with the 1.0.0 release there is a change in the format of the MQTT topic.  This will not impact Home Assistant users as the automatic configuration dynamically builds the topic anyway.  However, for those using this script with other MQTT tools and accessing the topics manually, the order of the topic levels has changed slightly, swapping the alarm and location_id levels.  Thus, prior to 1.0.0 the topics were formatted as:
```
ring/alarm/<location_id>/<ha_platform_type>/<device_zid>/
```
While in 1.0.0 and future versions it will be:

```
ring/<location_id>/alarm/<ha_platform_type>/<device_zid>/
```
While I was hesitant to make this change because it would break some setups, it seemed like the best thing to do to follow the changes in the ring alarm API from an alarm to a location based model.  This will make it more practical to add support for the new non-alarm Ring device which are being added to the API such as smart lighting and cameras while still grouping devices by location like follows:
```
ring/<location_id>/alarm
ring/<location_id>/cameras
ring/<location_id>/lighting
```
### Current Features
- Simple configuration via config file, most cases just need Ring user/password and that's it
- Supports the following devices:
  - Ring Contact and Motion Sensors
  - Ring Flood/Freeze Sensor
  - Ring Smoke/CO Listener
  - First Alert Z-Wave Smoke/CO Detector (experimental - testing needed)
  - Ring Alarm integrated door locks (status and lock control)
- Provides battery and tamper status for supported devices via JSON attribute topic (visible in Home Assistant UI)
- Full Home Assistant MQTT Discovery - devices appear automatically (also tested with OpenHAB 2.4 MQTT)
- Consistent topic creation based on location/device ID - easy to use with MQTT tools like Node-RED
- Arm/Disarm via alarm control panel MQTT object
- Arm/Disarm commands are monitored for success and retried (default up to 12x with 10 second interval)
- Support for mulitple alarms
- Monitors websocket connection to each alarm and sets reachability status if socket is unavailable (Home Assistant UI reports "unknown" status for unreachable), automatically resends device state when connection is established
- Can monitor Home Assistant MQTT birth message to trigger automatic resend of configuration data after restart.  The script will automatically resend device config/state 60 seconds after receiving online message from Home Assistant.  This keeps you from having to restart the script after a Home Assistant restart.
- Monitors MQTT connection and automatically resends device state after any disconnect/reconnect event
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Planned features
- Support for non-alarm devices (doorbell/camera motion/lights/siren)
- Support for generic 3rd party sensors

### Possible future features
- Additional Devices (base station, keypad - at least for tamper/battery status)
- Support for smart lighting
- Base station settings (volume, chime)
- Arm/Disarm with code
- Arm/Disarm with sensor bypass
- Dynamic add/remove of alarms/devices (i.e. no service restart required)

### Debugging
By default the script should produce no console output, however, the script does leverage the terriffic [debug](https://www.npmjs.com/package/debug) package.  To get debug output, simply run the script like this:

**Debug messages from all modules**
```
DEBUG=* ./ring-alarm-mqtt.js
````

**Debug messages from ring-alarm-mqtt only**
```
DEBUG=ring-alarm-mqtt ./ring-alarm-mqtt.js
```
This option is also useful when using script with external MQTT tools as it dumps all discovered sensors and their topics.  Also allows you to monitor sensor states in real-time on the console.

### Thanks
Much thanks must go to @dgrief and his excellent [ring-alarm API](https://github.com/dgreif/ring-alarm) as well as his homebridge plugin.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

I also have to give much credit to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for his original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.

