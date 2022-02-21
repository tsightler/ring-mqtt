## Standard Install 
Stanard installation is possible, however, this method is not regularly tested and this you will mostly on your own to solve any installation problems if you choose to use this method.

### Installation
#### Pre-requisites
- NodeJS version must be at least 14.17.0 (latest LTS is recommended)
- [rtsp-simple-server](https://github.com/aler9/rtsp-simple-server) v0.17.4 or later must be installed and available in the system path.
- The mosquitto clients package (mosquitto_sub/mosquitto_pub) must be available in the system path

#### Perform Install
Once the pre-requisites have been met simply clone this project from Github into a directory of your choice (the included systemd unit file below assumes /opt but can be easily modified):

`git clone https://github.com/tsightler/ring-mqtt.git`

Then switch to the ring-mqtt directory and run:

```
chmod +x ring-mqtt.js
npm install
```

This will install all of the required node dependencies.  Now edit the config.js file to configure your Ring refresh token and MQTT broker connection information and any other settings (see [Configuration Options](#configuration-options) below).  Note that the user the script runs as will need permission to write the config.json file as updated refresh tokens are written back directly to this file when running via standard install.

#### Configuration Options
| Config Option | Description | Default |
| --- | --- | --- |
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

### Authentication
Ring has made two factor authentication (2FA) mandatory thus the script now only supports this authentication method.  Using 2FA requires acquiring a refresh token using either the built-in web UI or the provided get-ring-token.js CLI tool.  Either method will prompt for account information and 2FA code, acquire the token and save it to the ring-state.json file.  From this point new tokens are updated automatically in the state file.  The two following methods are available for acquiring a token:

There are two primary ways to acquire this token:

#### Primary Method  
If the script is started and the ring_token config parameter is empty, it will start a small web service at http://<ip_of_server>:55123.  Simply navigate to this URL with your browser, enter your Ring account username/password and then 2FA code, and, if authentication is successful, the token will be saved and the script will connect to Ring and continue.

#### Alternative Method
Use the get-ring-token.js CLI utility which will prompt for your account information and 2FA code and the acquire the token and save it to the state file:
```
node ./get-ring-token.js
```

**!!! Important Note regarding the security of your refresh token !!!**  
Using 2FA authentication opens up the possibility that, if the environment runinng ring-mqtt is comporomised, an attacker can acquire the refresh token and use this to authenticate to your Ring account without knowing your username/password and completely bypassing the standard 2FA protections.  Please secure your environment carefully.

Because of this added risk, it can be a good idea to create a second account dedicated for use with ring-mqtt and provide access to the devices you would like that account to be able to control.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  However, if do choose to use a secondary, shared account there are some limitations as Ring does not allow certain devices and functions to be granted access to shared accounts.  When using a secondary account support for Chimes, Smart Lighting groups, and Base Station volume control will not function.
