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
                                                         - disarmed
                                                         - armed_home
                                                         - armed_away
                                                         - arming  (Exit delay)
                                                         - pending (Entry delay)
                                                         - triggered (device is in alarm state
                                                           Specific alarm type (fire/police) can be determined from panic switches (if enabled)
                                                           or from alarmState attribute in Info sensor
ring/<location_id>/alarm/<device_id>/alarm/command   <-- Set alarm mode (disarm/arm_home/arm_away)
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
ring/<location_id>/alarm/<device_id>/volume/state    <-- Get Volume (0-100)
ring/<location_id>/alarm/<device_id>/volume/command  <-- Set Volume (0-100)
                                                         Volume control requires master account, shared accounts do not have permission to control base station volume (same as Ring app)
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Keypad:
```
ring/<location_id>/alarm/<device_id>/volume/state    <-- Get Volume (0-100)
ring/<location_id>/alarm/<device_id>/volume/command  <-- Set Volume (0-100)
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Motion Sensor:
```
ring/<location_id>/alarm/<device_id>/motion/state     <-- ON = Motion Detected
ring/<location_id>/alarm/<device_id>/info/state       <-- Device info sensor
```

Contact Sensor:
```
ring/<location_id>/alarm/<device_id>/contact/state    <-- ON = Contact Open
ring/<location_id>/alarm/<device_id>/info/state       <-- Device info sensor
```

Retrofit Zone:
```
ring/<location_id>/alarm/<device_id>/zone/state      <-- ON = Zone Tripped
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

```
Tilt Sensor:
ring/<location_id>/alarm/<device_id>/zone/state      <-- ON = Tilt Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

```
Temperature Sensor:
ring/<location_id>/alarm/<device_id>/temperature/state  <-- Temperature in celcius
ring/<location_id>/alarm/<device_id>/info/state         <-- Device info sensor
```

Smoke Detector/Alarm:
```
ring/<location_id>/alarm/<device_id>/smoke/state     <-- ON = Smoke Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

CO Detector/Alarm:
```
ring/<location_id>/alarm/<device_id>/co/state        <-- ON = CO Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Smoke/CO Listener:
```
ring/<location_id>/alarm/<device_id>/smoke/state     <-- ON = Smoke Detected
ring/<location_id>/alarm/<device_id>/co/state        <-- ON = CO Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Flood/Freeze Sensor:
```
ring/<location_id>/alarm/<device_id>/flood/state     <-- ON = Flood Detected
ring/<location_id>/alarm/<device_id>/freeze/state    <-- ON = Freeze Detected
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Switch:
```
ring/<location_id>/alarm/<device_id>/switch/state    <-- Get ON/OFF state
ring/<location_id>/alarm/<device_id>/switch/command  <-- Set ON/OF state
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Dimmer Switch:
```
ring/<location_id>/alarm/<device_id>/light/state               <-- Get ON/OFF state
ring/<location_id>/alarm/<device_id>/light/command             <-- Set ON/OF state
ring/<location_id>/alarm/<device_id>/light/brightness_state    <-- Get brightness state (0-100)
ring/<location_id>/alarm/<device_id>/light/brightness_command  <-- Set brightness state (0-100)
```

Fan Switch:
```
ring/<location_id>/alarm/<device_id>/fan/state                 <-- Get ON/OFF state
ring/<location_id>/alarm/<device_id>/fan/command               <-- Set ON/OF state
ring/<location_id>/alarm/<device_id>/fan/speed_state           <-- Get fan preset speed
                                                                   - low (<=33%)
                                                                   - medium (>=34% && <=67%)
                                                                   - high (>=68%)
ring/<location_id>/alarm/<device_id>/fan/speed_command         <-- Set fan preset speed
                                                                   - low (33%)
                                                                   - medium (67%)
                                                                   - high (100%)
ring/<location_id>/alarm/<device_id>/fan/percent_speed_state   <-- Get fan speed in percent (10-100%)
ring/<location_id>/alarm/<device_id>/fan/percent_speed_command <-- Set fan speed in percent (10-100%)
ring/<location_id>/alarm/<device_id>/info/state                <-- Device info sensor
```

Locks:
```
ring/<location_id>/alarm/<device_id>/lock/state      <-- Get LOCKED/UNLOCKED state
ring/<location_id>/alarm/<device_id>/lock/command    <-- Set LOCK/UNLOCK state
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Ring Outdoor Siren:
```
ring/<location_id>/alarm/<device_id>/siren/state     <-- ON = Siren Activated
ring/<location_id>/alarm/<device_id>/info/state      <-- Device info sensor
```

Thermostat:
```
ring/<location_id>/alarm/<device_id>/thermostat/mode_state               <-- Current operating mode
                                                                             - off
                                                                             - cool
                                                                             - heat
ring/<location_id>/alarm/<device_id>/thermostat/mode_command             <-- Set operating mode
ring/<location_id>/alarm/<device_id>/thermostat/action_state             <-- Current action
                                                                             - off
                                                                             - idle
                                                                             - cooling
                                                                             - heating
                                                                             - fan
ring/<location_id>/alarm/<device_id>/thermostat/temerature_state         <-- Current target temperature °C
ring/<location_id>/alarm/<device_id>/thermostat/temerature_state         <-- Set target temperature °C
ring/<location_id>/alarm/<device_id>/thermostat/current_temerature_state <-- Current temperature °C
ring/<location_id>/alarm/<device_id>/thermostat/fan_mode_state           <-- Current fan operating mode
                                                                             Exact modes vary with different thermostat devices, common modes are
                                                                             - Auto
                                                                             - On
                                                                             - Circulate
ring/<location_id>/alarm/<device_id>/thermostat/fan_mode_command         <-- Set fan operating mode
ring/<location_id>/alarm/<device_id>/thermostat/aux_state                <-- ON = Aux heat mode enabled
ring/<location_id>/alarm/<device_id>/thermostat/aux_command              <-- Set aux heat mode
ring/<location_id>/alarm/<device_id>/info/state                          <-- Device info sensor
```

Cameras (available topics vary based by device capabilities):
```
ring/<location_id>/camera/<device_id>/ding/state                <-- ON = Doorbell Ding Detected
ring/<location_id>/camera/<device_id>/ding/attributes           <-- Last ding time
ring/<location_id>/camera/<device_id>/motion/state              <-- ON = Motion Detected
ring/<location_id>/camera/<device_id>/motion/attributes         <-- Last motion time, 
                                                                    person detect, motion detect enabled
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

```
Chime (available topics vary based by device capabilities):
ring/<location_id>/chime/<device_id>/volume/state              <-- Get Volume (0-11)
ring/<location_id>/chime/<device_id>/volume/command            <-- Set Volume (0-11)
ring/<location_id>/chime/<device_id>/snooze/state              <-- Get snooze state
ring/<location_id>/chime/<device_id>/snooze/command            <-- Set snooze state (ON = snooze)
ring/<location_id>/chime/<device_id>/snooze_minutes/state      <-- Get current minutes to snooze (1-1440)
ring/<location_id>/chime/<device_id>/snooze_minutes/command    <-- Set minutes to snooze (1-1440)
                                                                   Must be set prior to enabling snooze
ring/<location_id>/chime/<device_id>/play_ding_sound/state     <-- ON = Ding chime is playing
ring/<location_id>/chime/<device_id>/play_ding_sound/command   <-- Set ON = Play ding chime
ring/<location_id>/chime/<device_id>/play_motion_sound/state   <-- ON = Motion chime is playing
ring/<location_id>/chime/<device_id>/play_motion_sound/command <-- Set ON = Play motion chime
ring/<location_id>/chime/<device_id>/info/state                <-- Device info sensor
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

Modes Control Panel (virtual alarm control panel for setting Ring location modes for
locations with Ring cameras but not Ring alarm):
```
ring/<location_id>/alarm/<device_id>/mode/state      <-- Get location mode: ("disarmed", "armed_home", "armed_away")
ring/<location_id>/alarm/<device_id>/mode/command    <-- Set location mode: ("disarm", "arm_home", "arm_away")
```