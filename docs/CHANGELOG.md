## v5.2.0
**New Features**
- Basic support for Ring Intercom, the following features are supported:
  - Ding state - Simple binary sensor, stays "on" for 20 seconds after ding
  - Lock state - Unlock command is supported and also triggers on unlock from Ring app.  Stays in unlocked state for 5 seconds before reverting to locked state.
  - Battery status
  - Wifi status
- Due to popular demand, camera motion and ding event "on" duration can now be configured on a per-device basis.  For now, the default duration remains 180 seconds, which is based on the ding expire time property in the Ring API and aligned with first-generation motion sensors which would stay on "on" state for 180 seconds after any motion.  However, many users have requested a shorter notification time and second-generation motion sensors now use 20 seconds, so this value provides flexibility for those users.  Based on feedback, future versions may use a shorter "on" notification by default.

**Fixed Bugs**
- Fixed an issue with generic binary sensors which caused them to fail automatic discovery in Home Assistant

**Other Changes**
- Implement improved Home Assistant behavior for thermostats when switching between auto->heat/cool modes.  Requires Home Assistant 2023.3 release before it will work correctly but is much improved behavior from the previously used hack.  https://github.com/home-assistant/core/pull/87936

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

### Changes prior to v5.1.0 are tracked in the [historical changelog](https://github.com/tsightler/ring-mqtt/blob/main/docs/CHANGELOG-HIST.md)
