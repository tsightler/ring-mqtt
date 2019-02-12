# ring-alarm-mqtt
This is a simple script that leverages the ring alarm API available at [dgreif/ring-alarm](https://github.com/dgreif/ring-alarm) and provides access to the alarm control panel and sensors via MQTT.  It provides support for Home Assistant style MQTT discovery which allows for very easy integration with Home Assistant with near zero configuration (assuming MQTT is already configured).  It can also be used with any other tool capable of working with MQTT as it provides consistent topic naming based on location/device ID.

### Installation
Make sure Node.js (test with 8.x and higher) is installed on your system and then clone this repo:

`git clone https://github.com/tsightler/ring-alarm-mqtt.git`

Change to created ring-alarm-mqtt and run:

```
chmod +x ring-alarm-mqtt.js
npm install
```

This should install all required dependencies.  Edit the config.js and enter your Ring account user/password and MQTT broker connection information.  You can also change the top level topic used for creating ring device topics and also configre the Home Assistant state topic, but most people should leave these as default.

Now you should just be able to run the script

**TODO: Include a simple start/stop script**

### Optional Home Assistant Configuration
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

### Current Features
- Simple configuration via config file
- Home Assistant MQTT Discovery (also tested with OpenHAB 2.4)
- Consistent topic creation based on location/device ID
- Arm/Disarm via alarm control panel MQTT object
- Arm/Disarm commands are monitored for success and retried (default up to 12x with 10 second interval)
- Contact Sensors
- Motion Sensors
- Multiple alarm support
- Monitors websocket connection to each alarm and sets reachability status of socket is unavailable, resends device state when connection is established
- Can monitor Home Assistant MQTT birth message to trigger automatic resend of configuration data after restart.  The script will automatically resend device config/state 30 seconds after receiving online message from Home Assistant.  This keeps you from having to restart the script after a Home Assistant restart.
- Monitors MQTT connection and resends device state after any reconnect
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Planned Features
- Additional devices (Fire/CO2/Flood)
- Battery status for devices
- Tamper status

### Possible future features
- Base station settings (volume, chime)
- Arm/Disarm with code
- Arm/Disarm with sensor bypass
- Dynamic add/remove of alarms/devices (i.e. no service restart required)
- Support for non-alarm devices (doorbell/camera motion/lights/siren)

### Debugging
By default the script should produce no console output, however, the script does leverage the terriffic [debug](https://www.npmjs.com/package/debug) package.  To get debug, simply run the script like this:

**Debug messages from all modules**
```
DEBUG=* ./ring-alarm-mqtt.js
````

**Debug messages from ring-alarm-mqtt onlY**
```
DEBUG=ring-alarm-mqtt ./ring-alarm-mqtt.js
```
