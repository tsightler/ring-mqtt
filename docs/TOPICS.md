With this 4.x release topic levels have been refactored for consistency using the following general format
```
ring/<location_id>/<ring_category>/<device_id>/<device_type>/state
ring/<location_id>/<ring_category>/<device_id>/<device_type>/command
```

The <ring_category> is either "alarm", "smart_lighting", or "camera" based on the type of device.  Cameras are doorbells, stickup, spotlight or floodlight cams.  Alarm devices are any devices connected via the Alarm base station and smart_lighting is any device connected via the smart lighting bridge.

The script monitors cameras by polling health status every 60 seconds and monitors the websocket connections for alarm and smart lighting devices, automatically updating the online/offline state of the devices based on this connectivity information.  As this is device level connectivity is published to "status" at the device_id level:
```
ring/<location_id>/<product_category>/<device_id>/status
```

Each device also inlcudes an "info" sensor where the state topic includes various supplemental data for the device in JSON format.  This information varies by devies and includes data such as battery level, tamper status, communicaton state, volume, wifi signal strength, and other device specific data.

For the individual device capabilities the state and command topics are simple text strings (not JSON), which use the default values for the equivalent Home Assistant device integration.  Some sensors may have multiple attribues, such as a multi-level-switch as both on/off and brightness, so they will have a standard state/command topic and an additional topic in the format of <attribute>_state and <attribute>_topic.  Below is a listing of all currently supported devices and topics.

Alarm Control Panel (virtual device):
```
ring/<location_id>/alarm/<device_id>/alarm/state     <-- Alarm arming state
                                                         ("disarmed", "armed_home", "armed_away", "arming", "pending", "triggered")
ring/<location_id>/alarm/<device_id>/alarm/command   <-- Set alarm mode ("disarm", "arm_home", "arm_away")
ring/<location_id>/alarm/<device_id>/bypass/state    <-- Get arming bypass mode
ring/<location_id>/alarm/<device_id>/bypass/command  <-- Set arming bypass mode (When 'ON' arming will
                                                         automatically bypass any faulted contact sensors)
ring/<location_id>/alarm/<device_id>/siren/state     <-- Get Siren ON/OFF
ring/<location_id>/alarm/<device_id>/siren/command   <-- Set Siren ON/OFF
ring/<location_id>/alarm/<device_id>/police/state    <-- Get Polich Panic ON/OFF
ring/<location_id>/alarm/<device_id>/police/command  <-- Set Police Panic ON/OFF
ring/<location_id>/alarm/<device_id>/fire/state      <-- Get Fire Panic ON/OFF
ring/<location_id>/alarm/<device_id>/fire/command    <-- Set Fire Panic ON/OFF
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Alarm Base Station:
```
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
ring/<location_id>/alarm/<device_id>/volume/state    <-- Get Volume (0-100)
ring/<location_id>/alarm/<device_id>/volume/command  <-- Set Volume (0-100)
                                                         Requires master account, shared account does not
                                                         have permission to control base station volume
```

Ring Keypad:
```
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
ring/<location_id>/alarm/<device_id>/volume/state    <-- Get Volume (0-100)
ring/<location_id>/alarm/<device_id>/volume/command  <-- Set Volume (0-100)
```

CO detector:
```
ring/<location_id>/alarm/<device_id>/co/state        <-- ON = CO Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Contact Sensor:
```
ring/<location_id>/alarm/<device_id>/contact/state    <-- ON = Contact Open
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Retrofit Sensor:
```
ring/<location_id>/alarm/<device_id>/zone/state      <-- ON = Zone Tripped
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Fan switch:
```
ring/<location_id>/alarm/<device_id>/fan/state                 <-- Get ON/OFF state
ring/<location_id>/alarm/<device_id>/fan/command               <-- Set ON/OF state
ring/<location_id>/alarm/<device_id>/fan/speed_state           <-- Get fan preset speed ("low", "medium", "high")
ring/<location_id>/alarm/<device_id>/fan/speed_command         <-- Set fan preset speed ("low", "medium", "high")
ring/<location_id>/alarm/<device_id>/fan/percent_speed_state   <-- Get fan speed in percent (1-100%)
ring/<location_id>/alarm/<device_id>/fan/percent_speed_command <-- Set fan speed in percent (1-100%)
ring/<location_id>/alarm/<device_id>/info/state                <-- Device info sensor
```

Ring Flood/Freeze Sensor:
```
ring/<location_id>/alarm/<device_id>/flood/state     <-- ON = Flood Detected
ring/<location_id>/alarm/<device_id>/freeze/state    <-- ON = Freeze Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Locks:
```
ring/<location_id>/alarm/<device_id>/lock/state      <-- Get LOCKED/UNLOCKED state
ring/<location_id>/alarm/<device_id>/lock/command    <-- Set LOCK/UNLOCK state
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Modes Control Panel (virtual alarm control panel for setting Ring location modes for
locations with Ring cameras but not Ring alarm):
```
ring/<location_id>/alarm/<device_id>/mode/state      <-- Get location mode: ("disarmed", "armed_home", "armed_away")
ring/<location_id>/alarm/<device_id>/mode/command    <-- Set location mode: ("disarm", "arm_home", "arm_away")
```

Motion Sensor:
```
ring/<location_id>/alarm/<device_id>/motion/state     <-- ON = Motion Detected
ring/<location_id>/alarm/<device_id>/info/state       <-- Device info sensor
```

Dimmer switch:
```
ring/<location_id>/alarm/<device_id>/light/state               <-- Get ON/OFF state
ring/<location_id>/alarm/<device_id>/light/command             <-- Set ON/OF state
ring/<location_id>/alarm/<device_id>/light/brightness_state    <-- Get brightness state (0-100)
ring/<location_id>/alarm/<device_id>/light/brightness_command  <-- Set brightness state (0-100)
```

Smoke Detector:
```
ring/<location_id>/alarm/<device_id>/smoke/state     <-- ON = Smoke Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Smoke/CO listener:
```
ring/<location_id>/alarm/<device_id>/smoke/state     <-- ON = Smoke Detected
ring/<location_id>/alarm/<device_id>/co/state        <-- ON = CO Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Switch:
```
ring/<location_id>/alarm/<device_id>/switch/state    <-- Get ON/OFF state
ring/<location_id>/alarm/<device_id>/switch/command  <-- Set ON/OF state
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Outdoor Siren:
```
ring/<location_id>/alarm/<device_id>/siren/state     <-- ON = Siren Activated
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Cameras (available topics vary based by device capabilities):
```
ring/<location_id>/camera/<device_id>/ding/state                <-- ON = Doorbell Ding Detected
ring/<location_id>/camera/<device_id>/motion/state              <-- ON = Motion Detected
ring/<location_id>/camera/<device_id>/light/state               <-- Get Light ON/OFF
ring/<location_id>/camera/<device_id>/light/command             <-- Set Light ON/OFF
ring/<location_id>/camera/<device_id>/siren/state               <-- Get Siren ON/OFF
ring/<location_id>/camera/<device_id>/siren/command             <-- Set Siren ON/OFF
ring/<location_id>/camera/<device_id>/info/state                <-- Device info sensor
ring/<location_id>/camera/<device_id>/snapshot/image            <-- Snapshot images (JPEG binary data)
ring/<location_id>/camera/<device_id>/snapshot/attributes       <-- JSON attributes for image (timestamp)
ring/<location_id>/camera/<device_id>/snapshot_interval/state   <-- Get snapshot refresh interval
ring/<location_id>/camera/<device_id>/snapshot_interval/command <-- Set snapshot refresh interval
```

Ring Smart Lighting (available topics vary by device capabilities)
```
ring/<location_id>/lighting/<device_id>/motion/state              <-- ON = Motion Detected
ring/<location_id>/lighting/<device_id>/light/state               <-- Get Light ON/OFF
ring/<location_id>/lighting/<device_id>/light/command             <-- Set Light ON/OFF
ring/<location_id>/lighting/<device_id>/light/brightness_state    <-- Get brightness (0-100)
ring/<location_id>/lighting/<device_id>/light/brightness_command  <-- Set brightness (0-100)
ring/<location_id>/lighting/<device_id>/light/duration_state      <-- Get light duration (0-32767)
ring/<location_id>/lighting/<device_id>/light/duration_command    <-- Set light duraiton (0-32757)
ring/<location_id>/lighting/<device_id>/info/state                <-- Device info sensor
```
