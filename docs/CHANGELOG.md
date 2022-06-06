## v5.0.2
**!!!!! WARNING !!!!!**\
The 5.x releases are breaking release when upgrading from 4.x versions, please be sure to read the [v5.0.0](#v500) release notes below for full details as manual steps may be required.

**Dependency Updates**
- Bump ring-client-api to v11.0.4 (hopefully fixes some live stream connection issues)

**Other Changes**
- Suppress spurious error messages from push-receiver dependency during startup

## v5.0.1
**Fixed Bugs**
- Fixed a bug where some camera motion events were reported as dings
- Fixed an issue where camera events sometimes had timestamps from far in the past

## v5.0.0
**!!!!! WARNING !!!!!**\
This is a breaking release!  While efforts have been made to ensure the upgrade path is straightforward for most users, it was simply not possible to make the transition to new features and configuration methods without introducing breaking changes.  Users should carefully read [Upgrading to 5.x](https://github.com/tsightler/ring-mqtt/wiki/Upgrading-to-v5.x) on the project wiki page for more details prior to upgrading.

If you value stability over the absolute latest features, you may want to delay upgrades until v5.x has had some time to stabilize as the underlying number of changes is large and there will almost certainly be some bugs and regressions.  At a minimum **take a backup** prior to upgrading so that you can revert if things do not go to plan.

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
