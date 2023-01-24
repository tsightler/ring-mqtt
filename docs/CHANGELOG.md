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
- Switch to enable/disable the Chime Pro nightlight as well as report current nightlight on/off state via attribute.

**Other Changes**  
- Reduced average live stream startup time by several hundred milliseconds with the following changes:
  - Switched from rtsp-simple-server to go2rtc as the core streaming engine which provides slightly faster stream startup and opens the door for future feature enhancements.  This switch is expected to be transparent for users, but please report any issues.
  - Cameras now allocate a dedicated worker thread for live streaming vs previous versions which used a pool of worker threads based on the number of processor cores detected.  This significantly simplifies the live stream code and leads to faster stream startup and, hopefully, more reliable recovery from various error conditions.
- Migrated project codebase from CommonJS to ESM.  As this project is not a library this should have zero impact for users, but it does ease ongoing maintenance by enabling the ability to pull in newer versions of various dependent packages that have also moved to pure ESM.

**Dependency Updates**  
- Replaced problematic colors package with chalk for colorizing debug log output
- Bump ring-client-api to 11.7.1 (various fixes and support for newer cameras)
- Bump other dependent packages to latest versions

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

### Changes prior to v5.0.0 are tracked in the [historical changelog](https://github.com/tsightler/ring-mqtt/blob/main/docs/CHANGELOG-HIST.md)
