![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt/dev/images/ring-mqtt-logo.png)

## About
The ring-mqtt project acts as a bridge between alarm, smart lighting and camera devices sold by Ring LLC and an MQTT broker thus allowing any automation tools that can leverage the open standards based MQTT protocol to effectively integrate with these devices.  The project also supports video streaming by providing an RTSP gateway service that allows any media client supporting the RTSP protocol to connect to a Ring camera livestream or to play back recorded events (Ring Protect subscription required for event recording playback).  Please review the full list of [supported devices and features](https://github.com/tsightler/ring-mqtt/wiki#supported-devices-and-features) for more information on current capabilities.

**!!!! Important note regarding camera support !!!!**  
The ring-mqtt project does not turn Ring cameras into 24x7/continuous streaming CCTV cameras.  Ring cameras are designed to work with Ring cloud servers for on-demand streaming based on detected events (motion/ding) or interactive viewing, even when using ring-mqtt, all streaming still goes through Ring cloud servers and is not local.  Attempting to leverage this project for continuous streaming is not a supported use case and attempts to do so will almost certainly end in disappointment, this includes use with NVR tools like Frigate, Zoneminder or others.

If this advice is ignored, please note that there are significant functional side effects to doing so, most notably loss of motion/ding events while streaming (Ring cameras only send alerts when they are not actively streaming/recording), quickly drained batteries, and potential device overheating or even early device failure as Ring cameras simply aren't designed for continuous operation.  While you are of course welcome to use this project however you like, questions about use of tools that require continuous streaming will be locked and deleted.

## Installation and Configuration
Please refer to the [ring-mqtt project wiki](https://github.com/tsightler/ring-mqtt/wiki) for complete documentation on the various installation methods and configuration options.
