## Docker Install
For Docker installation details, please read this section entirely.  While it is possible to build the image locally from the included Dockerfile, it is recommended to install and update by pulling the official image directly from Docker Hub.  You can pull the image with the following command:
```
docker pull tsightler/ring-mqtt
```

### Docker Run
You can issue "docker run" and Docker will automatically pull the image, if it doesn't already exist locally, and then run the script.  The command line below is an example, please see the [Environment Variables](#environment-variables) section for all available configuration options:
```
docker run --rm -e "MQTTHOST=host_name" -e "MQTTPORT=host_port"  -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" -e "ENABLECAMERAS=true-or-false" -e "RINGLOCATIONIDS=comma-separated_location_IDs" tsightler/ring-mqtt
```

#### Storing Updated Refresh Tokens
The Docker container uses a bind mount to provide persistent storage.  While the Docker container will run without this storage, using the bind mount is highly recommended as, otherwise, it will sometimes be required to generate a new token when the container restarts since tokens eventually expire and there will be no way for an updated token to be stored in a persistent fashion. For more details on acquiring an initial refresh token please see ([Authentication](#authentication)).

You can use any directory on the host for this persistent store, but it must be mounted to /data in the container.  The following is an example docker run command using a bind mount to mount the host directory /etc/ring-mqtt to the container path /data:
```
docker run --rm --mount type=bind,source=/etc/ring-mqtt,target=/data -e "MQTTHOST=host_name" -e "MQTTUSER=mqtt_user" -e "MQTTPASSWORD=mqtt_pw" -e "RINGTOKEN=ring_refreshToken" tsightler/ring-mqtt
```

#### Starting the Docker container automatically during boot
To start the ring-mqtt docker container automatically during boot you can simply use the standard Docker methods, for example, adding ```--restart unless-stopped``` to the ```docker run``` command will cause Docker to automatically restart the container unless it has been explicitly stopped.

### Docker Compose
Docker Compose also works well if you prefer this method vs passing a large number of command line variables.  Below is an example Docker Compose file, please see the [Environment Variables](#environment-variables) section for all available configuration options:
```yml
version: "3.7"
services:
  ring-mqtt:
    container_name: ring-mqtt
    restart: unless-stopped
    image: tsightler/ring-mqtt
    ports:
      - 8554:8554                      # Enable RTSP port for external media player access
    volumes:
      - /etc/ring-mqtt:/data           # Mapping of local folder to provide persistant storage
    environment:                       
      - RINGTOKEN=                     # Required for initial startup, see: https://github.com/tsightler/ring-mqtt/blob/main/docs/DOCKER.md#authentication
      - MQTTHOST=localhost             # Hostname or IP of MQTT Broker
      - MQTTPORT=1883                  # TCP port for MQTT Broker
      - MQTTUSER=mqtt_user             # CHANGE ME -- Username for MQTT Broker (remove for anonymous)
      - MQTTPASSWORD=mqtt_password     # CHANGE ME -- Password for MQTT Broker (remove for anonymous)
      - ENABLECAMERAS=true             # Enable camera support
      - SNAPSHOTMODE=all               # Snapshot options (see: https://github.com/tsightler/ring-mqtt#snapshot-options)
      - LIVESTREAMUSER=stream_user     # CHANGE ME -- Highly recommended if RTSP server is exposed
      - LIVESTREAMPASSWORD=stream_pass # CHANGE ME -- Highly recommended if RTSP server is exposed
    logging:                           #limit logs to 10m and 3 files
      options:
        max-size: 10m
        max-file: "3"
 ```

### Environment Variables
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

### Authentication
Ring has made two factor authentication (2FA) mandatory thus the script now only supports this authentication method.  Using 2FA requires acquiring a refresh token for your Ring account and passing the token with the RINGTOKEN environment variable on initial startup.  From this point new tokens are acquired automatically and stored in the ring-state file for use during future startups.  The two following methods are available for acquiring a token:

#### Primary Method
Run the bundled ring-auth-cli utility directly via the Docker command line to acquire the token:
```
docker run -it --rm --entrypoint /app/ring-mqtt/node_modules/ring-client-api/ring-auth-cli.js tsightler/ring-mqtt
```

#### Alternative Method
Use ring-auth-cli from any system with NodeJS and NPM installed via npx, which downloads and runs ring-auth-cli on demand:
```
npx -p ring-client-api ring-auth-cli
```

**!!! Important Note regarding the security of your refresh token !!!**  
Using 2FA authentication opens up the possibility that, if the environment runinng ring-mqtt is comporomised, an attacker can acquire the refresh token and use this to authenticate to your Ring account without knowing your username/password and completely bypassing the standard 2FA protections.  Please secure your environment carefully.

Because of this added risk, it can be a good idea to create a second account dedicated for use with ring-mqtt and provide access to the devices you would like that account to be able to control.  This allows actions performed by this script to be easily audited since they will show up in activity logs with their own name instead of that of the primary account.  However, if do choose to use a secondary, shared account there are some limitations as Ring does not allow certain devices and functions to be granted access to shared accounts.  When using a secondary account support for Chimes, Smart Lighting groups, and Base Station volume control will not function.

### Docker Specific Features
#### External RTSP Server Access
When using the camera support for video streaming the Docker container will also run a local instance of rtsp-simple-server.  If your streaming platform runs on the same host you can usually just access directly via the Docker network, however, if you want to access the stream from other host on the network you can expose the RTSP port during startup as well.  Note that, if you choose to export the port, it is HIGHLY recommended to set a live stream user and password using the appropriate configuration options.

To expose the RTSP port externally simple add the standard Docker port options to your run command, something like "-p 8554:8554" would allow external media player clients to access the RTSP server on TCP port 8554.

#### Branch Selection
The Docker image includes a feature that allows for easy, temporary testing of the latest code from the master or dev branch of ring-mqtt from Github, without requiring the installation of a new image.  This feature was designed to simplify testing of newer code for users of the addon, but Docker users can leverage it as well.  When running the Docker image normally the local image copy of ring-mqtt is used, however, sometimes the latest code in the Github repo master branch may be a few versions ahead, while waiting on the code to stabilize, or a user may need to test code in the dev branch to see if it corrects a reported issue.  This feature allows this to be done very easily without having to push or build a new Docker image.  To use this feature simple add the **BRANCH** environment variable as follows:
**BRANCH="latest"**
When this option is set, upon starting the Docker container the startup script will use git to fetch the lastest code from the master branch before running
**BRANCH="dev"**
When this option is set, upon starting the Docker container the startup script will use git to fetch the lastest code from the dev branch before running

To revert to the code in the Docker image simply run the container without the BRANCH setting.
