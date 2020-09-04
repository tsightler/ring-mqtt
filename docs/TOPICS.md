With 4.0.0 topics level have been refactored for consistency using the following general format
```
ring/<location_id>/<ring_category>/<device_id>/<device_type>/state
ring/<location_id>/<ring_category>/<device_id>/<device_type>/command
```

The <ring_category> is either "alarm", "smart_lighting", or "camera" based on the type of device.  Cameras are doorbells, stickup, spotlight or floodlight cams.  Alarm devices are any devices connected via the Alarm base station and smart_lighting is any device connected via the smart lighting bridge.

The script monitors cameras by polling health status every 60 seconds and monitors the websocket connections for alarm and smart lighting devices, automatically updating the online/offline state of the devices based on this connectivity information.  As this is device level connectivity is published to "status" at the device_id level:
```
ring/<location_id>/<ring_category>/<device_id>/status
```

Each device also inlcudes an "info" sensor where the state topic includes various supplemental data for the device in JSON format.  This information varies by devies and includes data such as battery level, tamper status, communicaton state, volume, wifi signal strength, and other device specific data.

For the individual device capbilities the state and command topics are simple text strings (not JSON), which use the default values for the equivalent Home Assistant device integration.  Some sensors may have multiple attribues, such as a multi-level-switch as both on/off and brightness, so they will have a standard state/command topic and an additional topic in the format of <attribute>_state and <attribute>_topic.  Below is a listing of all currently supported devices and topics.

First Alert Smoke/CO detector and Ring Smoke/CO listener:
```
ring/<location_id>/alarm/<device_id>/smoke/state                <-- (ON = Smoke Detected)
ring/<location_id>/alarm/<device_id>/co/state                   <-- (ON = CO Detected)

```

3rd party multi-level switch:
```
ring/<location_id>/alarm/<device_id>/switch/state               <-- For on/off state
ring/<location_id>/alarm/<device_id>/switch/command             <-- Set on/off state
ring/<location_id>/alarm/<device_id>/switch/brightness_state    <-- For brightness state (0-100)
ring/<location_id>/alarm/<device_id>/switch/brightness_command  <-- Set brightness state (0-100)

```

Cameras:
```
ring/<location_id>/camera/<device_id>/ding/state                <-- Doorbell state (ON = Ding Detected)
ring/<location_id>/camera/<device_id>/motion/state              <-- Motion state (ON = Motion Detected)
ring/<location_id>/camera/<device_id>/light/state               <-- Light on/off state
ring/<location_id>/camera/<device_id>/light/command             <-- Set light on/off state
ring/<location_id>/camera/<device_id>/siren/state               <-- Siren state
ring/<location_id>/camera/<device_id>/siren/command             <-- Set siren state
```