## Camera Live Streaming
While ring-mqtt is primarily designed to integrate Ring devices into home automation platforms via MQTT to allow driving automations from those devices, there was high demand to provide live streaming integration as well, especially for Home Assistant users, but also to provide things like on-demand recording.  With the release of version 4.8.0 it is now possible to view live streams from any RTSP compatible client as well as trigger a recording event on a camera based on an automation using MQTT.

This document provides detailed information about the live streaming support include how to configure it with Home Assistant or use it with other medial players, as well as some troubleshooting information and known limitations.  If you would like to use the live streaming feature, please read this section carefully.

### Quick configuration with Home Assistant
Because MQTT camera support in Home Assistant only supports still images (due to the fact that MQTT is not a streaming technology) it is not currently possible to have Home Assistant automatically discover the Ring live streaming cameras via MQTT integration.  Because of this, the live streaming cameras will need to be configured manually in configuration.yaml.  Home Assistant provides a signficant number of camera platforms that can work with RTSP streams, but this document will focus on the setup of the [Generic IP Camera](https://www.home-assistant.io/integrations/generic/).

To setup the generic IP camera you will need to manually add entries to the configuration.yaml file.  How to do that is outside of the scope of this document so please read up on that if you are not familiar with editing Home Assistants configuration files.

Setting up a camera require a basic entry like this at a minimum:
```
camera:
  - platform: generic
    name: <Your Device Name Here>
    still_image_url: <image_url>
    stream_source: <stream_url>
```

Name is the name you want your camera to appear as in the Home Assistant UI.  The still_image_url can be an automatically updating image, so in the configuration below we will use a value template to pull the current snapshot image delivered via MQTT using the Home Assistant camera proxy API as this way when using the picture glance card the still image will be the most recent snapshot, while clicking the image will open a live stream.  Using this requires enabling snapshot support in the addon as well and works best with interval.  Note that you can also use any still image you wish.

The stream_source is the URL required to play the video stream.  To make the camera setup as easy as possible ring-mqtt attempts to guess the required entries and includes them as attributes in the camera info sensor.  Simply open the camera device in Home Assistant, select the Info sensor entity, and the open the attributes and there will be a stream source and still image URL entry that you can copy and paste to create your config.  Alternately, you can find the attributes using the Developer Tools portion of the UI and finding the info sensor entity for the camera.

The following example is uses a camera called "Front Porch".  The MQTT discovered snapshot camera has a Home Assistant entity ID of **camera.front_porch_snapshot** and the camera device ID is **3452b19184fa** so the attributes in the info sensor are as follows:
```
Still Image URL: http://my.ha.instance:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}  
Stream Source:   rtsp://3ba32cf2-ring-mqtt-dev.local.hass.io:8554/3452b19184fa_live
```
To create my generic IP camera in configuration.yaml I just need these lines:
```
camera:
  - platform: generic
    name: Front Porch Live
    still_image_url: http://my.ha.instance:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}
    stream_source: rtsp://3ba32cf2-ring-mqtt-dev.local.hass.io:8554/3452b19184fa_live
```

Note that the still_image_url is pulled from the local instance API so if you've change the port, enabled SSL, etc, you'll need to use the URL for your Home Assistant instance.  For example, if you access your Home Assistant instance directly via https://myha.mydomain.local/ then the URL would be https://myha.mydomain.local{{ states.camera.front_porch_snapshot.attributes.entity_picture }}.  If you are using SSL, but are generating self-signed certificates, or prefer to access the local instance via localhost instead of your oficially registered URL, you will need to add `verify_ssl: false` to the config as well because your SSL certificate will likely be bound to your hostname and thus won't work with localhost without this.

Once the configuraiton is saved, simply reload the configuration (generic IP camera entities can be reloaded with a full HA restart) and a new camera entity should appear which can now be added to the dashboard via a Picture Glance card.  With no special configuration this should now provide a card that provides still image snapshots based on your snapshot settings, and then, with a click, open a window that starts a live stream of that camera.

The picture glance card is quite flexible and it's possible to add the additional camera entities to this card as well, like the motion, light and siren switches (for devices with those features) and the stream switch.  With this setup it's possible to see at a glance if any motion/ding event is active, see the latest snapshot from that event, see the light/siren/stream state, and a simple click opens the live stream.

### Authentication
By default, the addon does not expose the RTSP server to external devices so only Home Assistant can actually access the streams, thus using a non-authenticated stream isn't too bad since the stream stays completely internal to the Home Assistant server.  This assumes that the addon is running on the same server as Home Assistant.

However, it is compleletly possible to access the live stream via external media clients like VLC or running your own ffmpeg, for example if you want to trigger a local recording or push an MJPEG stream to a TV.  However, if it is desired to expose the RTSP server, setting the **livestream_user/livestream_pass** configuraiton options (**LIVESTREAMUSER/LIVESTREAMPASSWORD** environment variables for standard Docker installs) is HIGHLY recommended prior to doing so.  Note that currently, even with a username and password, the stream is not encrypted, so using the stream over an untrusted network without a VPN is not recommended as is not a good idea.  Note that both username and password must be defined before this features is enabled.

If a username and password is defined then both publishers and streamers will require this password to access the RTSP server.  This is handled automatically for the stream publihsing and the RTSP URL will include the username/password in the URL so that they can be included in the **configuraiton.yaml**.  A sample is as follows:
```
camera:
  - platform: generic
    name: Front Porch Live
    still_image_url: http://localhost:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}
    stream_source: rtsp://streaming_user:let_me_stream!@3ba32cf2-ring-mqtt-dev:8554/3452b19184fa_live
```
### External RTSP Access
To allow streaming to external media clients you'll need to open the port for the RTSP server either via the addon configuration settings or via the Docker -p port forwarding option.  It's recommended to use TCP port 8554, but you can actually forward any external TCP port to the 8554 on the RTSP server in the container.  Note that streams will start automatically on-demand, and end ~5-10 seconds after the last client disconnects.  Multiple clients can connect to the same stream concurrently.  No MQTT access is needed for this to work, simply enter the RTSP URL into your media player.  If you defined a livestream username and password this will need to be included as well, most player will prompt for a username/password, but some require them to be included in the URL, for example:

`rtsp://streaming_user:let_me_stream!@3ba32cf2-ring-mqtt-dev:8554/3452b19184fa_live`

### Manually Starting a Stream
When a media client connects to the live stream server the stream is started automatically, however, there may be cases where you want to start a stream manually without a media client.  This is mostly usaful because every Ring live stream also creates a recording so doing this allows an automation to manually start and stop a recording.  This is possible using the "stream" switch which is exposed as an entity to Home Assistant and can of course be accessed by MQTT as well.  It performs like any switch, accepting "ON" and "OFF" to start and stop a stream repsectively.

Note that turning the stream off ALWAYS stops the live stream immediately, no matter how many clients are connected.

### FAQ

**Q) Why do streams keep running for 5+ minutes after viewing them in Home Assistant** 
**A)** Home Assistant keeps streams running in the background for ~5 minutes even when they are no longer viewed.  It's always possible to stop streams manually using the stream switch.

**Q) Streams keep starting all the time even when I'm not viewing anything**  
**A)** In Home Assistant, do not use the "Preload Stream" option and make server Camera View is set to "auto" instead of "live" in the picture glance card.  These other options attempt to start streams in the background for faster startup.  Because Ring cameras do not send motion events during streams, having streams running all the time will cause motion events to be missed.

**Q) Why does the live stream stop after ~10 minutes?**  
**A)** Ring enforces a time limit on active live streams and terminates them, typically at approximately 10 minutes, although sometimes significantly less and sometimes a little more.  Currently, you'll need to refresh to manually start the stream again but it is NOT recommended to attempt to stream 24 hours.  I say currently because Ring has hinted that continuous live streaming is something they are working on, but, for now, the code honors the exiting limits and does not just immediately retry as, otherwise, they may block access to their API completely.

**Q) Why is the stream delayed/lagged?**    
**A)** Likely this is due to the streaming technology used by Home Assistant that fully streams over HTTP/HTTPS.  While the technology is extremely reliable and widely compatible with various web browsers and network setups, it typically adds betwee 4-6 seconds of delay and sometimes as many as 10-15 seconds.  The best solution for Home Assistant is to use a custom UI card like the excellent [WebRTC Camera](https://github.com/AlexxIT/WebRTC) which will allow you to use your browsers native video playback capabilities, although this technology will likely require special configuration if you want to play back while outside of your network without using a VPN.  However, when configured, it provides typically 1 second or less delay so it's the best option when available.  Of course you can also view the streams with any other media player capable of RTSP playback.  VLC works well, but note that it buffers 1 second of video by default, although you can tweak this to reduce the delay.

**Q) Why do I have video artifacts and/or stuttering in the stream?**   
**A)** The live stream from Ring uses UDP to send the packets and is currently processed by ring-client-api inside of the NodeJS process before being sent via a pipe to ffmpeg.  While Node is quite fast for an interpreted language like Javascript, it's still not exactly the most efficient for real-time stream processing so you need a reasonable amount of CPU and is sensitive to latency.  Having a good CPU and a solid networking setup that does not drop UDP packets is critical to reliable function of the live stream.  If you have mulitple cameras, or a system with limited CPU/RAM (RPi3 for example) then you should limit concurrent live streams to just a few at a time for the most stable video.  In my testing a RPi3 struggles to support 4 concurrent streams, an RPi4 can handle about 6 concurrent streams, and a decent Intel based machine can handle about 3-4 streams per-core.  These numbers assume that the load on the CPU from other components is minimal.

**Q) Why do I see high memory usage?**  
**A)** Support for live streaming uses rtsp-simple-server, which is a binary process running in additional to the normal node process used by ring-mqtt.  When idle, this process uses very minimal memory (typically <20MB).  Also, every stream has at least one FFmpeg process to process the incoming stream and publish it to the server.  Total memory usage is typically about 25-30MB per each active stream on top of the base memory usage of the addon.  Also, when using Home Assistant, the Home Assistant memory usage will also increase for each stream.

**Q) Why are there no motion events while live streaming?**  
**A)** This is a limitaiton of Ring cameras as they do not detect/send motion events while a stream/recording is active.  The code itself has no limitations in this regard.

**Q) Why do I have so many recordings on my Ring App?**  
**A)** Ring "live streams" are actually recording sessions as well, so every time you start a live view of your camera you will get a recording on the Ring app.

### How it works - the gory details
The concept for streaming is actually very simple and credit for the original idea must go to gilliginsisland's post on the [ring-hassio project](https://github.com/jeroenterheerdt/ring-hassio/issues/51).  While I was already working on a concept implementation for ring-mqtt, when I saw that post I realized that there actually was a way to marry ring-mqtt with live streaming.  The post described a method to use rtsp-simple-server and it's ability to run a script on demand to directly run a node instance that leveraged ring-client-api to connect to Ring and start the live stream.  Since ring-mqtt already ran in node and used ring-client-api, and even had code for starting streams, I realized that, instead of starting a node script, I could just have rtsp-simple-server use MQTT to signal ring-mqtt to start the stream on demand while also allowing addon or MQTT users to start streams manually.

Digging more into rtsp-simple-server, I found that it not only had the ability to run a script on demand, but also included a simple REST API that meant it could be configured and controlled dynamically from the exiting ring-mqtt node instance.  Below is the general workflow:

1) During startup, ring-mqtt checks to see if camera support is enabled and, if so, spawns and monitors an rtsp-simple-server process.
2) After device discovery, ring-mqtt leverages the REST API of rtsp-simple-server to register an RTSP path and an on-demand script handler with the specific MQTT topic information for each camera.
3a) A stream is started by any media client connecting to the RTSP path for the camera (path is typically rtsp://hostname:8554/<camera_id>_live).
-- or --
3b) The command to manually start a stream is received via MQTT.  In this case ring-mqtt internally starts a small FFmpeg process that connects to the RTSP client to trigger the on-demand stream.  This process does nothing but copy the audio stream to null, just enough to keep the stream alive while keeping CPU usage <1%.  
4a) If an existing stream is already active and publishing to that path, the client simply connects to the existing stream in progress
-- or --
4b) If there is not currenty an active publisher for that stream, rtsp-simple-server runs a script which sends commands via MQTT to start the script and monitor the progress as ring-mqtt starts the stream.  Since this is just a simple shell script sending a single MQTT command to an already running process, the startup process is fast and lightweight since ring-mqtt already has a connection to the Ring API and the communication channel with MQTT is local and takes only a few ms.  Usually the live stream starts in <1 second although buffering by the media client usually means the stream takes a few seconds longer for the stream to actually appear in the UI or media client.  
5) The RTSP server continues to stream to the clients, once the stream times out on the Ring side, or the last client disconnects, rtsp-simple-server stops the on-demand script, which sends the MQTT command to stop the stream and exits.

The overall process is fairly light on CPU and memory because the ffmpeg process that is receiving the stream is only copying the existing AVC video stream to the RTSP server with no modification/transcoding.  The only transcoding is of the audio stream because the primary stream is G.711 μ-law while Home Assistant is compatible with AAC so the FFmpeg process does create and stream a second AAC based audio channel for maximum compaiblity (players can choose the stream with which they are compatible).
