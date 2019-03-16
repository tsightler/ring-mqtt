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

### Starting the service automatically during boot
I've included a sample service file which you can use to automaticlly start the script during system boot as long as your system uses systemd (most modern Linux distros).  The service file assumes you've installed the script in /opt/ring-alarm-mqtt and that you want to run the process as the homeassistant user, but you can easily modify this to any path and user you'd like.  Just edit the file as required and drop it in /etc/systemd/system then run the following:

```
systemctl enable ring-alarm-mqtt
```

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

### Current Features
- Simple configuration via config file
- Home Assistant MQTT Discovery (also tested with OpenHAB 2.4)
- Consistent topic creation based on location/device ID
- Arm/Disarm via alarm control panel MQTT object
- Arm/Disarm commands are monitored for success and retried (default up to 12x with 10 second interval)
- Contact and Motion Sensors
- First Alert Z-Wave Smoke/CO Detector (experimental - testing needed)
- Ring Smoke/CO Listener (experimental - testing needed)
- Ring integrated door locks (status and lock control)
- Multiple alarm support
- Monitors websocket connection to each alarm and sets reachability status of socket is unavailable, resends device state when connection is established
- Can monitor Home Assistant MQTT birth message to trigger automatic resend of configuration data after restart.  The script will automatically resend device config/state 30 seconds after receiving online message from Home Assistant.  This keeps you from having to restart the script after a Home Assistant restart.
- Monitors MQTT connection and resends device state after any reconnect
- Does not require MQTT retain and can work well with brokers that provide no persistent storage

### Planned Features
- Additional devices (Flood/Freeze sensors)
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

**Debug messages from ring-alarm-mqtt only**
```
DEBUG=ring-alarm-mqtt ./ring-alarm-mqtt.js
```

### Thanks
Much thanks must go to dgrief and his excellent [ring-alarm API](https://github.com/dgreif/ring-alarm) as well as his homebridge plugin.  Without his work it would have taken far more effort and time, probably more time than I had, to get this working.

I also have to give much credit to [acolytec3](https://community.home-assistant.io/u/acolytec3) on the Home Assistant community forums for his original Ring Alarm MQTT script.  Having an already functioning script with support for MQTT discovery saved me quite a bit of time in developing this script.
