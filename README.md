![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt/dev/images/ring-mqtt-logo.png)

## About
Ring LLC sells security related products such as video doorbells, security cameras, alarm systems and smart lighting devices.  The ring-mqtt project uses the Ring API (the same one used by Ring official apps) to act as a bridge between these devices and an local MQTT broker, thus allowing any automation tools that can leverage the open standards based MQTT protocol to effectively integrate with these devices.  The project also supports video streaming by providing an RTSP gateway service that allows any media client supporting the RTSP protocol to connect to a Ring camera livestream or to play back recorded events (Ring Protect subscription required for event recording playback).  Please review the full list of [supported devices and features](https://github.com/tsightler/ring-mqtt/wiki#supported-devices-and-features) for more information on current capabilities.

## Installation and Configuration
Please refer to the [ring-mqtt project wiki](https://github.com/tsightler/ring-mqtt/wiki) for complete documentation on the various installation methods and configuration options.

## Support and Feature Discussions
Due to ongoing challenges with poor quality, AI written Issues and Pull Requests, with little to no human insight or understanding, I've decided to restrict those to collaborators only for now.  If you are seeking help or have a feature request or suggestion, please use the appropriate [discussion group](https://github.com/tsightler/ring-mqtt/discussions).

#### IMPORTANT NOTE - Please read
Ring devices are sold as cloud based devices and this project uses the same cloud based API used by the Ring apps, it does not enable local control of Ring devices as there is no known facility to do so.  While using this project does not technically require a Ring Protect subscription, many capabilities are not possible without a subscription and this project is not intended as a way to bypass this requirement.  If you don't like cloud powered devices my suggestion is to not purchase them.
