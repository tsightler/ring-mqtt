![ring-mqtt-logo](https://raw.githubusercontent.com/tsightler/ring-mqtt/dev/images/ring-mqtt-logo.png)

## About
Ring LLC sells security related products such as video doorbells, security cameras, alarm systems and smart lighting devices.  The ring-mqtt project uses the Ring API (the same one used by Ring official apps) to act as a bridge between these devices and an local MQTT broker, thus allowing any automation tools that can leverage the open standards based MQTT protocol to effectively integrate with these devices.  The project also supports video streaming by providing an RTSP gateway service that allows any media client supporting the RTSP protocol to connect to a Ring camera livestream or to play back recorded events (Ring Protect subscription required for event recording playback).  Please review the full list of [supported devices and features](https://github.com/tsightler/ring-mqtt/wiki#supported-devices-and-features) for more information on current capabilities.

#### IMPORTANT NOTE - Please read
Ring devices are sold as cloud based devices and this project uses the same cloud based API used by the Ring apps, it does not enable local control of Ring devices as there is no known facility to do so.  While using this project does not technically require a Ring Protect subscription, many capabilities are not possible without a subscription and this project is not intended as a way to bypass this requirement.  If you don't like cloud powered devices my suggestion is to not purchase them.

Also, this project does not turn Ring video doorbells/cameras into 24x7/continuous streaming CCTV cameras as these devices are designed for event based streaming/recording or for light interactive viewing, such as answering the a doorbell ding, or checking on a motion event.  Even when using this project, all streaming still goes through Ring cloud servers and is not local.  Attempting to leverage this project for continuous streaming is not a supported use case and attempts to do so will almost certainly end in disappointment, this includes use with NVR tools like Frigate, Zoneminder or others.

If this advice is ignored, please note that there are significant functional side effects to doing so, most notably loss of motion/ding events while streaming (Ring cameras will only send alerts when they are not actively streaming/recording), quickly drained batteries, and potential device overheating or even early device failure as Ring cameras simply aren't designed for continuous operation.  While you are of course welcome to use this project however you like, questions about use of tools that require continuous streaming will be locked and deleted.

## Installation and Configuration
Please refer to the [ring-mqtt project wiki](https://github.com/tsightler/ring-mqtt/wiki) for complete documentation on the various installation methods and configuration options.

## Audio Playback (play prerecorded clips out of the speaker)
ring-mqtt can play prerecorded audio clips out of a camera/doorbell speaker using the same two-way talk path that the Ring app uses when you answer a doorbell.  This is handy for automations (e.g. play a "please leave the package by the door" message, an alarm tone, or a barking dog).

**Configuration**

| Option | Default | Description |
| --- | --- | --- |
| `enable_audio_playback` | `false` | Set to `true` to enable the feature. |
| `media_directory` | `/data/media` | Directory that ring-mqtt scans for audio files.  Created automatically if missing. |

**Usage**
1. Enable `enable_audio_playback` and (optionally) set `media_directory`.
2. Copy short audio files into the media directory.  `mp3`, `wav`, `ogg`, `opus`, `flac`, `m4a`, `aac` and other formats ffmpeg can decode are supported.  For the Home Assistant addon this directory lives on the addon's persistent storage, which you can reach via the Samba/file-editor addons; for bare installs just copy files to the path on the host.
3. ring-mqtt automatically creates one Home Assistant **button** per file (e.g. a file named `alarm.mp3` becomes an `Alarm` button under the camera device).  Files are detected automatically (filesystem watch plus a periodic poll for network shares), so adding or removing a file adds or removes its button without a restart.
4. Press the button (or publish any payload to the button's MQTT command topic) and the clip plays out of that device's speaker.  Playback opens a brief, self-terminating WebRTC call, so it works at any time from an automation without first starting the live stream.

**Notes**
- All Ring cameras/doorbells have a speaker, so the buttons appear for every enabled camera.  If the same media directory is shared by multiple cameras, each camera gets its own set of buttons so you can target a specific device.
- Battery-powered devices may be slower to connect and, like live streaming, can be blocked by Ring Modes settings (you'll see a 403 in the logs if so).
