## v5.0.0
**New Features**
- Add support for thermostats with "auto" operating mode with low/high temperature range setting
- Add support for Ring glassbreak sensors

**Fixed Bugs**
- Use atomic writes for updating state/config file.  Hopefully this will fix the occassional report of corrupted state file

**Breaking Changes**
- Docker users are now *REQUIRED* to map a persistent volume for storing state.  This was always highly recommended, and I'm guessing most users already configured one so it probably won't break in many cases, but theoretically it was possible to run without it.
- For Docker users, the initial refresh token can no longer be set via the RINGTOKEN environment variable.  To supply a new token users must use ring-auth-cli.js to generate a refresh token a new state file.
- For Standard install users, the config file no longer contains the refresh token and is no longer updated with new tokens.  After upgrade a new ring-state.json file will be created in the ring-mqtt directory to store state (same method as Docker installs).  The token from the config file will be used for this initial startup, the new token saved in the ring-state.json file and the remaining token removed from the config file permanently. Note that Standard installs are considered self-supported and I highly recommend the Docker/Addon install options for the vast majority of users.

**Other Changes**
- Standardized discovery logic for parent/child devices.  The child discovery logic is now contained completely in device level code.  Previously this logic was implemented as hard coded exceptions in the common discovery loop which was pretty ugly and risked breaking other devices.  Now such devices can be added with no significant changes to the common code although further improvements are still needed here.

## v4.9.1
**New Features**
- Add support for Ring Outdoor Smart Plug (thanks to @mopwr for suffering through my poor coding mistakes while testing)

**Fixed Bugs**
- Implement retries for snapshot updates.  This is mostly for battery cameras which, when the snapshot interval is set to mulitple minutes, can enter a powersave mode that takes more than 1 second (the previous timeout) for the snapshot update request to be processed.  The code will now attempt to retrive the updated snapshot once a second for 5 seconds instead. (thanks to @jackyaz for reporting and testing the fix)
- Workaround for light state toggling on cameras due to slow state updates on Ring servers.  Now any time light state is set via ring-mqtt polled updates are paused for 30 seconds to give time for API server to have proper state.  Not a perfect solution but the best I could come up with for now.
- Siren switch now correctly activates siren test on Ring Ourdoor Siren (thanks to @Mincka for reporting and testing)

## v4.9.0
This release is primarily a dependency bump to catch up with 3 months worth of updates in other projects during my break from this project.

**Dependency Updates**
- Bump NodeJS package dependencies to latest versions
- Bump the following code in the Docker image:
  - Alpine to 3.15
  - Bump BashIO to v0.14.3
  - NodeJS to v16 in the Docker image
  - RTSP Simple Server to v0.17.13 (Standard install will need to manually update to this version as an API change breaks backwards compatibility with prior versions of RTSP Simple Server)

**Other Changes**
- Minor change to security panel initialization to avoid a warning that occurred during startup in some configurations

## v4.8.5
**Minor Enhancements**
- Abandon use of getSnapshot() function in favor of internal snapshot implementation in all cases (previously the internal implementation was used only for motion snapshots)
- More granular debug output selection and standardizaion which makes it easier to visually parse logs.  For now the default debug output for the Docker and addon versions is still all categories, but users can now reduce logging or select more limited debug output with the following debug options:
  - ring-mqtt - Startup messages and MQTT topic/state messages for primary text based entity topics
  - ring-attr - MQTT topic/state messages for JSON attribute topics
  - ring-disc - MQTT Home Assistant style discovery messages (for large environments can be quite wordy during startup)
  - ring-rtsp - Logging related to the RTSP streaming functions

**Other Changes**
- Refactor documentation

## v4.8.4
**Fixed Bugs**  
- Event streams failed to update status to off/inactive after event finished playing, causing various replay issues
- Minor change to default filter for value templates entities to hopefully quiet warnings for openHAB users attempting to leverage this project via the Home Assistant MQTT binding

**Minor Enhancements**
- Chimes snooze switch now includes additional JSON attribute with "minutes_remaining" showing approximate number of minutes before snooze expires.

## v4.8.3
**New Features**
- The event stream select entity now includes eventId and recordingUrl attributes with values updated based on the selected event to facilitate automatic downloading of recorded videos. See the [camera documentation](CAMERAS.md) for more information and an example automation using Home Assistant downloader service.
- Dome sirens (and perhaps other Z-wave sirens) are now supported

**Fixed Bugs**
- Refactor and simplify snapshot functions, especially for battery cameras.  This should hopefully fix the issue of no motion snapshots for users with battery powered cameras.

**Breaking Changes**
- Siren devices are now represented as a switch instead of a binary_sensor.

**Other Changes**
- Device debug output now includes device name for all entries, including all received commands

## v4.8.2
**New Features**
- Support streaming video of historical motion/ding/on-demand events via new event stream RTSP path.  See the [camera documentation](CAMERAS.md) for more details. (Note that this feature requires a Ring Protect plan that allows saving videos)
- Info sensor support for Ring Bridge (thanks to [alexanv1](https://github.com/alexanv1) for this PR!)

**Fixed Bugs**
- Bump ring-client-api to 9.21.2 to address issue with error on toggling camera lights on/off
- Fix alarm state attribute not resetting to all-clear after an alarm trigger event

## v4.8.1
**Fixed Bugs**
- Fix tamper entity state not updating on tamper events
- Fix typo in still image URL (thanks to [aneisch](https://github.com/aneisch) for the PR!)

**Minor Enhancements**
- Add additional debug message for on-demand stream trigger
- Small enhancement to still image and stream URL generation to hopefully make a slightly better "guess"
- Monitor legacy hassio/status topic for birth/last will messages to inform of HA restarts for users with setups still using older defaults

**Other Changes**
- Update to rtsp-simple-server 0.17.3, hopefully slightly reduces stream startup time
- Minor tweak to docker image to allow running under Docker as non-root user.  Requires adding S6_READ_ONLY_ROOT=1 to docker run environment.
- Documentation tweaks to clarify camera setup steps, especially for still image URL.

## v4.8.0
**New Features**  
Live Video Streaming is here!  

Since this plugin introduced support for cameras over 2 years ago, the single most requested feature, which I usually answered will "never be supported", is live streaming.  I didn't believe this feature would ever fit within this project simply because this script used MQTT for integration, which simply isn't a platform that can support streaming, other than the limited capabilities used for the snapshot feature.

However, because of continued demand for live streaming, I was reasearching and prototyping possible methods for integrating live streams when I saw a post from [gilliginsisland](https://github.com/jeroenterheerdt/ring-hassio/issues/51) on the ring-hassio Github issues page.  The final result uses rtsp-simple-server with an on-demand script that triggers the livestream via MQTT, and it was the concept in that post that provided the imputus to finally do the work in a way that felt like a proper fit within this project.

I have some additional features planned for the coming weeks, mainly the ability to play the last X recorded events, but I wanted to get something out there now for people to play with and see how it works in a wider range of environments than my test setup.  

Features included in this release:
- Easy(-ish) integration with Home Assistant, although note that it is not automatic.  Live streaming cameras must be manually added to Home Assistant configuration.yaml.  Please Rrad [the camera docs](CAMERAS.md) for more details.
- Support for on-demand live streams.  Streams are started automatically when viewed in Home Assistant and ended 5-10 seconds after the last viewer disconnects
- Support for external medial player by exposing the RTSP port on the addon any tool that supports RTSP streaming can consume the stream.
- Support for defining a username and password for authenticating the stream.
- Manual stream start via the "stream" switch entity or via MQTT command.  Allows for cool things like triggering a recording using automation.

**Minor Enhancments**  
- Increased maximum allowed time between snapshots from 3600 seconds (1 hour) to 604800 (7 days)
- Repopulate entities and states much sooner after Home Assistant restart is detected
- New algorithm for pulling motion snapshots from battery cameras.  Uses less CPU and should generate a more reliable image with less artifacts, but will be a little slower.

**Fixed Bugs**  
- Fix interval snapshots when using only "interval" setting vs "all"

**Other Changes**  
- Docker image now uses S6 init system for supervising node process
- Massive startup script cleanup and standardization

### Changes prior to v4.8.0 are tracked in the [historical changelog](https://github.com/tsightler/ring-mqtt/blob/main/docs/CHANGELOG-HIST.md)
