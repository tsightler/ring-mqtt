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
