### This is the historical changelog, for changes in current versions please see the [current changelog](https://github.com/tsightler/ring-mqtt/blob/main/docs/CHANGELOG.md).

## v5.9.3
**Bugs Fixed**
 - Updated ring-client-api with patched push-receiver package to address push messages failing decryption with ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY message, potentially leading to missed motion/ding events for cameras/doorbells/intercoms.
 - Fix crash due to unexpected security panel when users only have a Sidewalk based Ring device such as Kiddie Smoke/CO detector
 - Fix Kiddie Smoke/CO states not properly updated during smoke/co detection events (testing welcome)
 - Implement minor changes to attempt to address sporadic authentication issues reported by a small number of users

**Dependency Updates**
 - aedes 1.0.0
 - body-parser 2.2.2
 - mqtt 5.15.0
 - ring-client-api 14.3.1-beta.0 (custom)
 - werift 0.22.9
 - write-file-atomic 7.0.1
 - Go2RTC 1.9.14

## v5.9.2
This update attempts to workaround an issue causing MQTT automatic discovery to fail randomly in a small number of cases.  As far as I can tell, this is an upstream issue as the API is reporting the MQTT service unavailable even though the Mosquitto addon is running and HA is connected.  The new code simply checks that the MQTT service exist and uses the crednetials in any case, ignoring the reported service status.  I have no idea if this will fix the reported issue as this code hasn't been touched in ages and I can't reproduce the issue, but I saw some other addons that made similar changes in recent months, so I thought it was worth a shot.

**Dependency Updates**
 - Go2RTC 1.9.12 (revert to upstream version as exec hang issues appear to be fixed now)

## v5.9.1
**Bugs Fixed**
Fix an issue introduced with new Express server that kept web authenticator UI from starting.

## v5.9.0
This is mostly a depedency update after a long while without any updates, but I bumped the minor version as this should also enable experimental support for the following new devices:

 - The Ring Video Intercom should now be detected, however, functionality is limited to the same features supported with prior non-Video version (i.e. no video features)
 - The Kiddie Smoke/CO devices should be detected, however, this is the first supported non-Zwave alarm device and I have no idea if state updates will actually work as I do not have this hardware to test.  Success or failure reports are highly appreciated.

**Dependency Updates**
 - @homebridge/camera-utils 3.0.0
 - body-parser 2.2.1"
 - chalk 5.6.2
 - debug 4.4.3
 - express 5.2.1
 - is-online 12.0.2
 - js-yaml 4.1.1
 - mqtt 5.14.1
 - ring-client-api 14.2.0
 - werift 0.22.2
 - write-file-atomic 7.0.0
 - NodeJs 22.21.1
 - Bashio 0.17.5
 - go2rtc 1.9.12

## v5.8.1
**Bugs Fixed**
Update ring-client-api to address a recent Ring API change which caused socket connections to fail and crash the ring-mqtt process.

**Dependency Updates**
 - chalk 5.4.1
 - mqtt 5.13.0
 - ring-client-api 14.0.0-beta.2
 - rxjs 7.8.2
 - werift 0.22.1
 - NodeJS 22.12.0
 - S6 Overlay 3.2.1.0
 - Bashio 0.17.0

## v5.8.0
The 5.8.x branch is focused primarily on cleaning up various portions of the code to improve long-term maintainability, there are no major features planned for this branch.

**Minor Enhancements**
- The web based authenticator has been completely re-written in this release. It now serves an singlem dynamic html document, from memory, properly displays error messages, more safely handles sensitive data such as passwords/2fa codes (information is deleted from session state immediately after it is submitted) and uses an updated theme that integrates more cleanly into the Home Assistant UI, including automatic support for light/dark mode.

**Dependency Updates**
 - @homebridge/camera-utils 2.2.7
 - debug 4.4.0
 - expess 4.21.2
 - mqtt 5.10.3
 - ring-client-api 13.2.1
 - NodeJS 22.12.0

## v5.7.3
**Minor Enhancements**
- Instead of silently blocking device discovery, offline hubs will now be listed in the log which should make it easier for users to identify the device causing the issue.
- Updated ring-client-api now uses long-lived HTTPS connections, improving performance and dramtically reducing the number of DNS queries and firewall connections logged, which could previously make dozens, or even hundreds of queries per minute.
- Suppress spurious 'Message dropped as it could not be decrypted' messages from push-receiver which didn't cause any problems but just seemed to confuse people.

**Bugs Fixed**
- Upated ring-client-api uses long-lived HTTPS connections which should work around the hangs experienced in some environments during startup.  Much thanks to @RoryJMc for amazing help testing and providing logs which finally led to a solution to this issue.

**Dependency Updates**
- mqtt 5.10.2
- ring-client-api 13.2.1-beta.0

## v5.7.2
**Bugs Fixed**
- Fix an isse that caused push notifications for camera/doorbell/intercom motion and ding events to stop working after interruptions in network connectivity lasting more than a few minutes.
- Fix an issue with Modes where the incorrect mode was sometimes published during initial startup.  Thanks to @wahflz for the PR to address this!
- Fix a locking issue which prevented live and event streams from being active concurrently on the same camera.

**Dependency Updates**
- aedes 0.51.3
- body-parser 1.20.3
- date-fns 4.1.0
- debug 4.3.7
- express 4.21.1
- ffmpeg 7.0.2
- is-online 11.0.0
- mqtt 5.10.1
- node 22.11.0
- push-receiver 4.3.0
- ring-client-api 13.2.0-beta.1
- s6-overlay v3.2.0.2
- werift 0.20.1
- write-file-atomic 6.0.0

## v5.7.1
**New Features**
- Add experimental support for Zooz water valves.  This support is currently untested, but was developed using user data dumps kindly contributed from several users and also based on a similar PR submitted for ring-homebridge from another user.  Please feel free to open an issue on the Github project page if you have problems with this device and thanks to all involved for their support.

**Dependency Updates**
- ring-client-api v13.1.0

## v5.7.0
This release migrates to the new FCM HTTP v1 API for push notifications as the legacy FCM/GCM APIs have been deprecated for some time and shutdown of those legacy APIs started in late July 2024.  While the transition to this new API should be transparent for most users, the under the hood changes are signfiicant including an entirely new push notification format.  While the goal is to make this transition as seemless as possible, it is impossible to guarantee 100% success.  If you experience issues with motion/ding notification from cameras, doorbells or intercoms after upgrading to this version, please follow the standard push notification troubleshooting steps as follows:

1) Open the ring-mqtt web UI and note the device name
2) Stop the ring-mqtt addon/container
3) Navigate to the Ring Control Center using the Ring App or Ring Web console
4) Locate the device with the matching device name from step 1 in Authorized Client Devices and delete it
5) Restart the addon and use the addon web UI to re-authenticate to the Ring API

**Minor Enhancements**
- A significant amount of work has gone into improving the reliability of streaming, especially the live stream.  In prior versions there were various failure scenarios that could lead to states where future streaming requests would not succeed and the only option was to restart the entire addon/container.  Hours of testing have gone into this version and many such issues have been addressed.

**Dependency Updates**
- ring-client-api v13.0.1
- go2rtc v1.9.4 (custom build to fix a hang on exit issue)
- Alpine Linux 3.20.2
- NodeJS v20.15.1
- s6-overlay v3.2.0.0

## v5.6.7
This release is intended to address an ongoing instability with websocket connections by using a newer API endpoint for requesting tickets.

**Dependency Updates**
- ring-client-api v12.1.1

## v5.6.6
This release reverts go2rtc to v1.9.2 to address streaming stability issues caused by exec handling changes that were implemented in go2rtc v1.9.3.

**Dependency Updates**
- aedes v0.51.2
- debug v4.3.5

## v5.6.5
This release is intended to address the current brokenness of HA 2024.6.x by forcing the alarm control panel entity discovery to set code_arm_required = false even when no code is configured.  While I believe this should be fixed in upstream HA, I have no influence over if/when that will happen and this workaround should have no negative impact on older versions.

**Dependency Updates**
- go2rtc v1.9.3
- mqtt v5.7.0
- werift v0.19.3

## v5.6.4
**Minor Enhancements**
- New attributes alarmClearedBy/alarmClearedTime are updated when alarm is in triggered state and is cleared via the keypad or app.
- Some entities now have categories assigned so that they appear in Configuration and Diagnostic categories in the Home Assistant UI.  This also means that these entities will not be automatically included in generated views, for example, when exporting devices from Home Assitant to another platform like HomeKit, although you can still manually choose to export those entities if desired. Thanks to @xannor for initial PR for this feature.

**Bugs fixed**
- Fixed an issue where the alarm state would lose syncronization if alarm was disarmed but a fire/co alarm was triggered and then cleared.  Thanks to @iptvcld for reporting this issue and providng the details required to reproduce.

**Dependcy Updates**
- Alpine Linux 3.18 (Docker image)
- go2rtc v1.8.5
- ring-client-api v12.1.0
- werift v0.19.1
- aedes v0.51.0
- mqtt v5.5.2
- express v4.19.2
- s6-overlay v3.1.6.2
- bashio v0.16.2

## v5.6.3
**Minor Enhancements**
- lastArmBy/lastDisarmBy now reports correct names for guest users as well as shared users
- Locks now support "LOCKING" and "UNLOCKING" status which provides for a richer experience in the Home Assistant UI
- HVAC enhanced to use new "supported_features" capability in Home Assistant >2023.9.  This allows ring-mqtt to inform Home Assistant which arming modes are supported thus suppressing unavailable arming modes from being visible in the Home Assistant user interface.

**Other Changes**
- Remove auxillary heat implementaion which was deprecated in Home Assistant 2023.9.  Auxillary/emergency heat is still available but is now exposed as a preset mode instead (behavior is duplicated from the Z-wave thermostat implementation).
- Suppress hass warnings from go2rtc (cosmetic only)

**Dependcy Updates**
- go2rtc v1.7.1
- ring-client-api v12.0.1

## v5.6.2
**Bugs Fixed**
- Fix crash when discovering Ring Bridge due to missing operator

## v5.6.1
**New Features**
- Add support for configuring chirp tones for Ring binary sensors
- Return support for Ring Bridge which was temporarily removed in v5.6.0 due to phantom devices for some users
- Snapshot camera attributes now include the snapshot type of the current snapshot in addition to the previous timestamp attribute.  Snapshot types can be any of "motion", "ding", "interval" or "on-demand".  This can assist with automation cases where a specific snapshot type is preffered.  However, note that no snapshot is ever guarateed and it can sometimes take multiple seconds to request and return a snapshot so, as an example, if the automation is triggered by motion, but then waits for a motion snapshot, a timeout should also be included to keep the automation from waiting forever if for some reason the snapshot could not be retrieved.

**Dependcy Updates**
- go2rtc v1.7.0

## v5.6.0
**New Features**
- Cameras now include a button entity to request an on-demand snapshot.  This was a much requested feature and is intended primarily to allow snapshots to be triggered from automations (in Home Assistant this can be doen via the button press service).  Note that on-demand snapshots are limited to no more than one request every 10 seconds, more frequent requests will be logged, but otherwise ignored.  Also, low-power Ring cameras are unable to take snapshots while recording so there is no guarantee that a request for a snapshot on these cameras will be possible.
- For doorbells it's now possible to get snapshots from ding events in addition to motion events and new snapshot modes have been introduced to select which combination of ding, motion, and interval snapshots are desired.  Ding snapshots are enabled by default for both Auto and All modes, but note that battery cameras will likely require a Ring subscription to get reliable snapshots from dings, just like motion.
- Add support to enable/disable chirps on Ring keypads

**Other Changes**
- Adapt MQTT discovery messages to new entity naming guidelines introduced in Home Assistant 2023.8
- Minor tweak for tamper sensor to increase compatibility with OpenHAB (thanks to @zolakk for the PR)
- Merge and simplify WebRTC connection code and include recent minor updates for better reliability
- Try to capture and log null responses during web token generation

**Dependcy Updates**
- ring-client-api v12.0.0
- aedes v0.50.0
- werift 0.18.5


## v5.5.1
**New Features**
- Improved support for HEVC mode cameras\
  While the initial support for HEVC required local transcoding, this update uses a different streaming API that is able to negotiates down to H.264/AVC for these cameras on-the-fly which means HEVC enabled cameras should now work fine even on lower-performance hardware like RPi3/4 devices.  Hopefully this new API does not break streaming for other cases.

**Other Changes**
- Use a non-cached snapshot for all cases
- Implement multiple retries if initial request for snapshot update fails

**Dependency Updates**
- go2rtc v1.6.2

## v5.5.0
**New Features**
- Initial support for HEVC mode cameras\
  Ring is actively enabling the H.265/HEVC codec on some newer camera models and the Ring Andriod-app based API used by ring-mqtt actively rejects any other protocol for these cameras.  The Ring web based dashboard uses a different API which appears to support negotiating H.264/AVC with these devices as a fallback but, so far, I haven't been able to get it to work correctly with ring-mqtt, hopefully that will be resolved eventually.

  Passing HEVC through unchanged presents too many compatibility issues with downstream devices to be practical so, for now, ring-mqtt will attempt to transcode these streams back to H.264/AVC on-the-fly.  This provides wide compatibiltiy with downstream devices, but at the cost of significantly increased CPU usage during streaming.

  Ideally, over time, more browsers will add H.265/HEVC support to their WebRTC implementations so passthrough will become a viable option, but, for now, transcoding provides a quick and dirty hack that will at least allow these cameras work in many cases.  Note that if you are running on a RPi3 this will probably not work, and an RPi4 will barely be able to support a single stream.
- Add switch to toggle motion warning for cameras that support this feature
- Implement new logic for entry/exit delay (inspired by @amura11):
  - Exit delay now supports both home and away modes
  - Depends on actual events from Ring API vs previous blind wait function
  - Alarm attributes now include "exitSecondsLeft" and "entrySecondsLeft" which will count down during entry/exit delay.
  - Alarm attributes now include "targetMode" so it's possible to know what mode alarm is attempting to enter even while exit delay is in progress.  For entry delay this attribute makes it possoble to know what mode the alarm was in when the entry delay was triggered.  This allows creating different automations for entry/exit delays based on the home and away arming modes.

**Bugs Fixed**
- Fix an issue detecting subscriptions and suppress spurrious error messages from cameras in case of accounts with no paid subscription.
- Request non-cached snapshots for motion events on high-powered cameras even if no UUID is available (e.g. no subscription).
- Make stream source and still image URL attributes work even if calls to heath check API fail.

**Dependency Updates**
- go2rtc v1.6.0
- werift v0.18.4

## v5.4.1
**Bugs Fixed**
- Fix alarm state not updating for various conditions (armed/disarmed with keypad, exit-delay, etc)

## v5.4.0
This release is mostly to get back to stable ring-client-api version with final fixes for camera notification issues, however, managed to sneak in one highly requested feature and a few minor improvements as well.

**New Features**
- Alarm control panel now includes lastArmedBy/lastDisarmedBy attributes making it possible to determine who/what triggered an arm/disarm event.

**Other Changes**
- Device Name/System ID is now displayed in the Web UI and CLI authentication tools providing easier identification of the corresponding device in the Authorized Devices section of the Ring Control Center.
- Camera event management has been completely reworked using a new event management API.  Primary goal was to avoid API throttling issues that could occur with large numbers of cameras (>50% reduction in API calls, even more during startup).

**Bugs Fixed**
- Fixed an issue where motion snapshots might return an cached snapshot instead
- Fixed an issue with panic switches where a burglar alarm could trigger both police and fire panic states.

**Dependency Updates**
- ring-client-api v11.8.0
- bashio v0.15.0

## v5.3.0
The primary goal of this update is to address issues with camera/doorbell/intercom notifications that have impacted many users due to changes in the Ring API for push notifications.  This version uses a new upstream ring-client-api that persist the FCM token and hardware ID across restarts which will hopefully address these issues, however, it's important to note that addressing this will likely require users to re-authenticate following the instructions below:

**Steps to fix notifications**
If you have cameras/doorbells/intercoms and are not receiving notifications you will need to follow these steps to re-establish authentication with the Ring API:

1. Stop the addon and verify that it is no longer running
2. In the official Ring App or using the Ring web based dashboard go to the Control Center
3. Click on Authorized Client Devices
4. In the list of authorized devices find and remove all devices associated with ring-mqtt, these devices will have names like the following:
   - ring-mqtt
   - ring-mqtt-addon
   - Device name not found
   - Unknown device
5. Once you have removed all of these devices restart the addon.
6. Review the addon logs and it should show that the existing token is invalid and you need to use the web UI to create a new one
7. Use the addon web UI to authenticate with Ring and re-establish the connection with the Ring API
8. Notifications should now be working!

**New Features**
- Added support to enable/disable motion detection for cameras

**Fixed Bugs**
- Use persistent FCM tokens so that push notifications survive restarts
- Remove doubled-up devices in Ring Control Center, including one "unknown device" when authenticating
- Fix random crash of go2rtc process which impacted some users (fixed by bumping go2rtc to v1.5.0)

**Dependency Updates**
- ring-client-api v11.8.0-beta.0
- werift v0.18.3
- rxjs v7.8.1
- go2rtc v1.5.0
- s6-overlay v3.1.5.0

## v5.2.2
**Fixed Bugs**
- Update ring-client-api to v11.7.5 which should fix issues with web token generation caused by changes in Ring API.

## v5.2.1
**Fixed Bugs**
- Update ring-client-api to v11.7.4 which should fix an issue with motion snapshots not working due to a change in push notification data sent by the Ring API.
- Suppress spurious "Lost subscription to ding" messages in log which led to confusion for users.

**Other Changes**
- Tamper sensors now use "tamper" device class in Home Assistant vs the generic "problem" device class used previously.

**Dependency Updates**
- Bump go2rtc to v1.3.1

## v5.2.0
**New Features**
- Basic support for Ring Intercom, the following features are supported:
  - Ding state - Simple binary sensor, stays "on" for 20 seconds after ding
  - Lock state - Unlock command is supported and also triggers on unlock from Ring app.  Stays in unlocked state for 5 seconds before reverting to locked state.
  - Battery status
  - Wifi status
- Keypad proximity sensor is now exposed as a motion sensor (only tested with Keypad Gen2 model)
- Implement improved Home Assistant behavior for MQTT thermostats when switching between auto and heat/cool modes.  Requires Home Assistant 2023.3 release or later, but provides much improved behavior which should mirror that of thermostats connected directly via Z-wave.
- Based on requests, camera motion and ding event "on" duration can now be configured on a per-device basis.  For now, the default duration remains 180 seconds, which is based on the ding expire time property sent as part of the ding event in the Ring API and also aligned with first-generation motion sensors which would stay in "on" state for 180 seconds after any detected motion.  However, many users have requested a shorter "on" duration and second-generation motion sensors now use 20 seconds, so this new feature provides flexibility for those users.  Based on feedback, future versions may use the shorter "on" duration by default.

**Fixed Bugs**
- Fixed an issue with generic binary sensors which caused them to fail automatic discovery in Home Assistant.

**Dependency Updates**
- Bump go2rtc to v1.2.0
- Bump werift to v0.18.2 with some WebRTC stun negotiation improvements.  May fix livestream failures for users with more complex network setups.
- Bump ring-client-api to v11.7.2
- Bump s6-overlay to v3.1.4.1

## v5.1.3
**Fixed Bugs**
- Don't crash on codec mismatch.  This is caused by the fact that Ring has started rolling out support for the HEVC/H.265 video encoding format on some devices and cameras, however, this format still has many issues and incompatibilities in downstream browsers and devices.  For now the suggestion for ring-mqtt users is to enable [Legacy Video Mode](https://support.ring.com/hc/en-us/articles/4417503172116-Legacy-Video-Mode-) for any cameras that are using this codec as default.

**Other Changes**
- Include RTX as part of WebRTC codec negotiation which can improve robustness and reduce artifacting of the livestream in cases where there is minor UDP packet loss.
- Disable WebRTC port on internal go2rtc instance.

**Dependency Updates**
- Bump go2rtc version to v1.1.2
- Bump s6-overlay to v3.1.3.0

## v5.1.2 (re-publish of v5.1.1)
**Fixed Bugs**
- Fix crash on Chime Pro (1st Generation) models

## v5.1.0
After several releases focused on stability and minor bug fixes this release includes significant internal changes and a few new features.

**!!!!! WARNING !!!!!**
Starting with 5.1.x all backwards compatibiltiy with prior 4.x style configuration options has been removed.  Upgrades from 4.x versions are still possible but will require manual conversion of any legacy configuration methods and options.  Upgrades from 5.0.x versions should not require any changes.

**New Features**
- Added ability to refine event stream to only motion events where a person is detected
- Option to select transcoded vs raw video for event stream (this also changes the URL for scripting automatic download of recordings):
  - Raw video (default) - This video is exactly as it was recorded by the camera and is the same as previous versions of ring-mqtt
  - Transcoded video - This is the same as selecting to share/download video from the Ring app or web dashboard.  This video includes the Ring logo and timestamps and may include supplemental pre-roll video for supported devices.  Note that switching from a raw to transcoded event selection can take 10-15 seconds as transcoded videos are created by Ring on-demand so ring-mqtt must wait for the Ring servers to process the video and return the URL.
- New camera models should now display with correct model/features
- Improved support for cameras with dual batteries.  The BatteryLevel attribute always reports the level of currently active battery but the level of both batteries is individually available via the batteryLife and batteryLife2 attributes.
- Switch to enable/disable the Chime Pro nightlight.  The current nightlight on/off state can be determined via attribute.

**Other Changes**
- Reduced average live stream startup time by several hundred milliseconds with the following changes:
  - Switched from rtsp-simple-server to go2rtc as the core streaming engine which provides slightly faster stream startup and opens the door for future feature enhancements.  This switch is expected to be transparent for users, but please report any issues.
  - Cameras now allocate a dedicated worker thread for live streaming vs previous versions which used a pool of worker threads based on the number of processor cores detected.  This simplifies the live stream code and leads to faster stream startup and, hopefully, more reliable recovery from various error conditions.
  - The recommended configuration for streaming setup in Home Assistant is now to use the go2rtc addon with RTSPtoWebRTC integration.  This provides fast stream startup and shutdown and low-latency live vieweing (typically <1 second latency).

**Dependency Updates**
- Replaced problematic colors package with chalk for colorizing debug log output
- Bump ring-client-api to 11.7.1 (various fixes and support for newer cameras)
- Bump other dependent packages to latest versions
- Migrated project codebase from CommonJS to ESM.  As this project is not a library this should have zero impact for users, but it does ease ongoing maintenance by enabling the ability to pull in newer versions of various dependent packages that have also moved to pure ESM.

## v5.0.5
**!!!!! NOTE !!!!!**  
This is a stability release only and I'm happy to announce that, with this release, the 5.x versions are now considered stable.  Analytics indicate that over 90% of ring-mqtt users are already runnning a 5.x release and, overall, there are very few reported issues.  Still, it is highly recommened to **take a backup** prior to upgrading so that you can revert if things do not go to plan.  

**!!!!! WARNING !!!!!**  
The 5.x releases are breaking releases when upgrading from 4.x versions, please be sure to read the [v5.0.0](#v500) release notes below for full details as manual steps may be required following an upgrade from 4.x versions.  Please note that support for direct upgrade from 4.x versions will be deprecated once the 5.1.x releases begin rolling out later this year so upgrading now is highly recommended.

**Fixed Bugs**  
- Fix typo in the camera event stream function that caused ring-mqtt to crash during event stream shutdown.

## v5.0.4
**Fixed Bugs**
- Modified init scripts to detect cases where Home Assistant Services API is not available during startup and exit with error (might fix cases where MQTT service and authentication discovery fails after a hard shutdown/restart)
- Implement check and automatic recovery from null refresh token which can occur during Ring service outages.  Previously a manual restart of ring-mqtt was required after Ring outages that involved authentication failures.
- Fix a case where regenerating a new refresh token failed to properly re-authenticate the API without restarting the addon.

**Dependency Updates**  
- Bump ring-client-api to v11.3.0 to pull in latest push-receiver fixes for improved stability with motion/ding events

## v5.0.3
**Fixed Bugs**  
- Fix to prevent cases where live stream get stuck in "on" state even though no stream is active
- Fix incorrect model name for First Alert CO alarms

**Other Changes**  
- Additional debug logging on token updates in the hope of tracking down token refresh issues
- Additional logging for live stream WebRTC connection start/end
- Increase live stream timeout for no clients to 10 seconds.  Cameras that take more than a few seconds to start a stream may work on the 2nd attempt with this change.

**Dependency Updates**  
- Migrate from v2 to v3 of s6-overlay process supervisor
- Bump ring-client-api to v11.2.1 (new camera models and minor fixes)
- Update rtsp-simple-server to v0.20.0 (misc RTSP fixes)
- Move to latest Alpine 3.16 image and various minor package updates

## v5.0.2
**Dependency Updates**
- Bump ring-client-api to v11.0.4 (hopefully fixes some live stream connection issues)

**Other Changes**
- Suppress spurious error messages from push-receiver dependency during startup

## v5.0.1
**Fixed Bugs**
- Fixed a bug where some camera motion events were reported as dings
- Fixed an issue where camera events sometimes had timestamps from far in the past

## v5.0.0
**!!!!! WARNING !!!!!**
This is a breaking release!  While efforts have been made to ensure the upgrade path is straightforward for most users, it was simply not possible to make the transition to new features and configuration methods without introducing breaking changes.  Users should carefully read [Upgrading to 5.x](https://github.com/tsightler/ring-mqtt/wiki/Upgrading-to-v5.x) on the project wiki page for more details prior to upgrading.

**New Features**
- Uses the newly released ring-client-api v11.x which brings the following features:
  - Push notifications vs polling for camera ding and motion events
    - Significantly faster notifications
    - Access to rich notifications which allows grabbing the same snapshot use for rich notifications in the Ring app (requires Ring Protect plan and rich notifications to be enabled)
  - Faster and more relaible snapshot updates
  - Live streaming via WebRTC protocol vs the legacy SIP based streaming from prior versions
    - Faster and more reliable streaming startup
    - Support for devices with Ring Edge enabled (ring-mqtt must have direct network connectivity to Ring Edge device)
- New URL based MQTT configuration method with full support for TLS encryted connects to MQTT broker
- Support for the following new devices:
  - Ring glassbreak sensors
  - Ring Floodlight Pro security cameras
- Support for additional device features:
  - Thermostat "auto" operating mode with low/high (dual setpoint) temperature range settings
  - Volume support for Ring Outdoor Siren (thanks to @roylofthouse for the PR)
- Per-device settings with persistence across restarts:
  - Arming bypass mode for sensors
  - On duration for smart lighting
- Per-camera snapshot settings

**Fixed Bugs**
- Use atomic writes for updating state/config file.  Hopefully this will fix the occassional report of corrupted state files.

**Breaking Changes**
- See [Upgrading to ring-mqtt v5.x](https://github.com/tsightler/ring-mqtt/wiki/Upgrading-to-v5.x) on the project wiki page for details

**Other Changes**
- Standardized discovery logic for multi-component devices

**Dependency Updates**
- Bump ring-client-api to 11.0.0 which adds support for new devices and uses updated APIs for snapshots and video streaming.
- Update rtsp-simple-server to 0.18.2
- Require NodeJS v16 (latest LTS version is recommended)

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

## v4.7.3
**Minor Enhancements**
- Documentation updates no note that Chimes only work with primary Ring account, not shared accounts
- Tweak logging color scheme to improve event readability
- Make uncaught exception error handler log error message

**Other Changes**
- Switch Docker base image to Node LTS-Alpine 3.14 (previously Alpine 3.12)

## v4.7.2
**Fixed Bugs**
- Add check for optional entities in publish and command processing to avoid crashes (most commonly an issue for Smart Lighting support where different devices have varying capabilities)
- Fix broken exit handler

## v4.7.1
**Fixed Bugs**
- Smart Lighting support caused crashes in 4.7.0
- Proper use of systemId with Ring authentication (addon only for now, hopefully eliminates spamming Authorized Client Devices in Account Control Center)

## v4.7.0
***** IMPORTANT NOTE *****  
Due to changes in the way ring-mqtt generates configuration topics it is HIGHLY recommended to restart the Home Assistant instance as soon as possible after the upgrade of this addon.  Without this Home Assistant will log warnings/errors about non-unqiue entity IDs.  While ring-mqtt does generate unique IDs for entities, version 4.7.0 has standarized the generation of configuraiton topics which results in slightly different topics for some devices.  Because of this, the Home Assistant discovery process thinks it is seeing new devices with the same IDs as existing entities.  Restarting Home Assistant will allow for a fresh discovery cycle, and, since the entity IDs did not change from previous versions, only the configuration topics, there should be no changes required to existing devices.  For more details on the underlying engine changes you can read the "Other Changes" section below.

**New Device Support**
 - Ring Chimes
     - Chime Volume
     - Enable/Disable Snooze Mode (and display Snooze State) 
     - Set Snooze Minutes (must be set prior to enabling snooze mode)
     - Play Ding/Motion Sound
     - Wireless Signal Strength
 - Temperature Sensors
 - Thermostats (Currently only tested with Honeywell T6 Pro Z-wave Thermostat, would be interested in success/fail reports for others)

**New Features**
  - Alarm devices now have individual entities for battery and tamper state (shoutout to @rechardhopton for the concept)
    Additional battery status data (charging state, auxillary batteries, etc) is available in the battery attributes
    All device attributes are still available in the Info sensor attributes to keep from breaking any existing monitoring
  - Battery cameras now show battery status as a separate entity with attributes for detailed battery status
  - Battery status will now report in battery column in Home Assistant Devices UI
  - Wifi strength now has it's own entity for alarm Base Station, Cameras and Chimes connected via wireless networks
  - Wireless network name is available in wireless entity attributes

**Minor Enhancements**
  - Improved default icons for various entities
  - Debug output now includes devices names along with topics and state for easier identification of activity
  - On first startup a unique system ID is generated and stored in the state file.
  - Authorized Client entries for this addon now identify as "ring-mqtt-addon" or "ring-mqtt" (based on addon or docker/standalone mode) in the Ring Control Center
  
**Breaking Changes**
  - Due to the introduction of seperate entities for battery, tamper, and wireless status, the primary info sensor state for most devices has been changed to commStatus for most alarm devices (still alarmState for the Alarm Control Panel, and acStatus for Base Station, Range Extender, and Keypad).  For Cameras and Chimes the Info sensor state is now the last health update time (i.e. the last time health data was updated by Ring servers, usually every 4-8 hours, but sometimes longer).  Any automations or scripts that monitored the primary info sensor state, rather than a sepcific info sensor attribute, will need to be updated to use the new entity sensors.

**Fixed Bugs**
  - "Addressed 'dict object' has no attribute" warnings due to changes in Home Assistant >=2021.4
  
**Other Changes**  
  Underneath the covers there are quite a number of changes to the engine with the primary goal to simplify and standardize device support and, in turn, make it easier to maintain and add new device support.  The prior model, if it can be called that, was a disaster of my own making with different devices using inconsistent methods for generating unique entity IDs and configuration topics.  This is primarily because I never really thought much about the device model when ring-mqtt was first created as there was only alarm, motion, and contact sensors.  Other devices have been bolted on haphazardly along the way without much thought or consistency so that needed to change and no better time than now.
  
  With the new model, device entities are defined in a consistent way and entity ID's, names, and MQTT topics are generated promgratically and consitently across all devices.  Key features of the new model:
  - Entities are defined using a simple JSON format, sometimes requiring as little as one line to define a simple entity
  - Home Assistant discovery messages are now built using a single, common function vs being hand coded for each device.  I've tried to maintain bug for bug compatibility with legacy versions, but I could have missed something so let me know if you see odd things.
  - All MQTT topics are built automatically by the discovery function and saved to the entity object
  - All device types (alarm, camera, chimes, smart lighting), now use a common base device and consistent functions
  - Command processing is now unified for all devices
  - All "special case" processing during device publishing/republishing is removed
  - Entity topic and state properties use a more consistent naming across all devices

  A primary goal of the new engine is to be 100% compatible with prior ring-mqtt to avoid breaking users during upgrades, however, this proved to be quite difficult.  I think I've managed to make the update nearly transparent, and I've tested the upgrade process on ~90% of supported devices, however, I don't own any locks, fans, or smart lighting devices, and, while I do attempt to fake them for testing purposes, I can't be 100% sure I didn't miss something.  Please feel free to report any devices or entities that either don't work or are duplicated after the upgrade.

## v4.6.3
 - Changes to snapshot interval now immediately cancel current interval and start new interval with the updated duration
 - Fix for Home Assistant with snapshot interval values > 100 seconds (valid values are now 10-3600 seconds)
 - Improved default icons for Home Assistant entities for snapshot interval, beam duration and volume level
 - Additional discovered devices debugging during startup including device name and id

## v4.6.2
 - Version bump to pull in changes required to fix 404 errors on startup due to Ring API changes

## v4.6.1
 - Add code to (hopefully) remove old light based volume controls from Home Assistant

## v4.6.0
 - Adapt fan component to new fan schema introduced in Home Assistant 2021.3.  This schema is based on percentage vs using three preset speeds.  Presets for "low, medium, high" will still work but it's now possible to use the new percent based speed topics which map directly to Ring app and Home Assistant.  This is especially useful for fans which support more than 3 speeds.
 - Add support to define the default "on" duraton for Ring Smart Lighting via config option beam_duration (or BEAMDURATION envionment variable), please refer to README for more details
 - Add ability to override "on" duration for individual Ring Smart Lights via MQTT topic, also uses number integraiton to present in Home Assistant for easy access via Lovalace UI or automations
 - Add support for "arming" state during exit delay
 - Add support for configuring a disarm code for Home Assistant (See disarm_code option in README)
 - Add support for reporting basic status and attributes of Ring External Siren
 - Docker images now enable debug logging by default (was already true of addon)
 - Removed "enable_volume" config option since the new number based integration will no longer be accidentally triggered by light based automations
 
 **Breaking Changes**
 - The required fan changes are implemented in a way that should not break any existing direct MQTT integrations and fan automations in Home Assistant should continue to work with backwards compatibility.  However, it's probably a good idea to update any automations to use new methods (see Fan section of [Breaking Changes](https://www.home-assistant.io/blog/2021/03/03/release-20213/#breaking-changes) in Home Assistant 2021.3 release notes) and to review the new percent based speed topics as well.
 - Volume controls now use Home Assistant number component instead of the previouls light component.  Any automations for volume changes will need to be updated to use the new comopnent.
 
## v4.5.7
 - Switch to custom ring-client-api with fix for hang during network/service outages
 - Add MotionDetectionEnabled attribute to camera motion entity attributes
 - Add support for snapshot interval setting via Home Assitant number entity

## v4.5.6
 - Experimental release with custom ring-client-api (not published to addon)

## v4.5.5
 - Improve stream reliability with new Ring media servers by bumping to ring-client-api 9.18.0
 
## v4.5.4
 - New, lightweight and hopefully improved snapshot from live stream implementation for battery cameras
 - Send "online" status prior to sending state data updates
 - Bump dependencies

## v4.5.3
 - Implement reconnect improvements for cameras after lost connections
 - Bump ring-client-api version

## v4.5.2
 - Second attempt to fix truncation of video length (tries to read property if available, otherwise keeps stream alive for 60 seconds)

## v4.5.1
 - When attempting to grab snapshot from livestream for battery cameras, set stream duration equal to video recording length setting to (hopefully) avoid truncating video recording

## v4.5.0
 - Snapshot on motion reliability improvements for line powered cameras
 - Snapshot on motion attempts to grab image from livestream for battery powered cameras.  This is slower, less reliable and sometimes produces lower quality images vs snapshots, but as battery cameras don't allow snapshots wile streaming, it's the only option for getting a snapshot of a motion event
 - Person detect attribute for camera motion events (needs testing, only works if person detection is enable on accout and show up as person detect events in history)
 - Date/Time uses standard format accross all attributes
 - Retrofit zones are now included as bypass eligible sensors when bypass arming is enabled
 - Docker image updated to Node v14 to hopefully address reconnect issues
 - Fix various crash bugs in camera support
 - Drop support for i386 architecture for docker image

## v4.4.0
 - Add support for sensor bypass during arming

## v4.3.2
 - Change enable_snapshots config option to snapshot_mode (fix for addon)

## v4.3.1
 - Add support for scheduled snapshot updates (see docs for details)

## v4.3.0
 - Add support for sending snapshot images on camera motion events (must be explicitly enabled)

## v4.2.2
 - Bump dependencies to latest versions
 - Rebuild Docker image with latest base to pull in latest node v12 version (12.20.1)

## v4.2.1
- Add tilt sensor support (Garage Doors)
- Fix range extender device name
- Minor doc updates

## v4.2.0
- Add support for Zwave Range Extender info sensor data (thanks to @alexanv1)
- Make volume control support configurable
- Minor fix for running on 10.x Node versions
- Monitor legacy hass/status stopic for Home Assistant restarts
- Documentation updates and cleanups

## v4.1.1
- Fix enabling panic buttons for Docker
- Fix branch feature when running Docker as unprivileged user

## v4.1.0
- New Feature: Branches
  Simple testing of latest git repo versions from master or dev branch without updating addon.
- Use common image for addon and standalone Docker users
- Reduced Docker image size by ~65MB
- Fix issue with Docker image not being cleaned during upgrades/uninstall (unfortunately won't help for existing images, suggest existing users run "docker system prune" to remove old images)
- Web tweaks to work reasonably with both dark/light themes
- Minor fix for CO sensor to report correct manufacturer

## v4.0.4
- Minor fixes for smart lighting support
- Fix (hopefully) non-fatal resubscribe errors
- Fix a few typos in various devices
- Bump MQTT dependency to 4.2.1

## v4.0.3
- Fix for Smart Lighting motion sensor discovery bug introduced in 4.0

## v4.0.2
- Additional volume control fixes for base station and keypad
- Volume controls show up as lights due to limitations of MQTT component available but you change icons and labels in frontend.

## v4.0.1
- Fixes for various MQTT discovery issues
- Reintroduce manual options for MQTT broker settings (override automatic discovery)
- Minor fixes for Base Station volume and info sensor and Keypad volume

## v4.0.0
- Support for Home Assistant Device Registry
- Each device has an "info" sensor updated at least every 5 minutes. State is JSON data with values unique to each device type (battery level, tamper status, AC state, wireless strength, firmware info, serial number, etc)
- Support for monitoring alarm state
  - "Pending" state is equivalent to "entry delay"
  - "Triggered" state is any alarm
  - Detailed alarm state is available via info sensor to get detailed alarm state info:
    - 'entry-delay'
    - 'burglar-alarm'
    - 'fire-alarm'
    - 'co-alarm'
    - 'panic'
    - 'user-verified-burglar-alarm'
    - 'user-verified-co-or-fire-alarm'
    - 'burglar-accelerated-alarm'
  | - 'fire-accelerated-alarm'
- Support for Fire and Polic Panic Buttons
  - *** Should be Used with Caution *** -- Can trigger alarm events with response
  - Can also be used as a high level monitor for burglar or fire alarms (panic state will trigger based on alarm type)
- Support for Base Station
  - Info sensor for monitoring battery/ac status
  - Ability to set volume (requires use of master account as other accounts don't have permission)
- Support for Keypad
  - Info sensor for monitoring batter/ac status, charging state, etc.
  - Ability to set volume
- Basic support for 3rd party Z-wave contact and motion sensors
  - Assumes device is concact sensor unless device name contains the word "motion"
- Significantly enhanced Web UI for token generation (mostly for Home Assistant Addon)
- Improved debug output with more organized location/device discovery output
- Simplified and standardized location/device handling code (still more work to do but becoming far more maintainable)

##Changes for v3.3.0 and earlier were not tracked in this file
