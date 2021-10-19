## Camera Video Streaming
While ring-mqtt is primarily designed to integrate Ring devices into home automation platforms via MQTT to allow driving automations from those devices, there was high demand to provide video streaming integration as well, especially for Home Assistant users, but also to provide features like on-demand recording.  With the release of version 4.8.0 it is now possible to view videos streams from any RTSP compatible client as well as trigger a recording event on a camera based on an automation using MQTT.

This document provides detailed information about the video streaming support, including how to configure it with Home Assistant or use it with other medial players, as well as some troubleshooting information and known limitations.  If you would like to use the videos streaming features, please read this section carefully.

**!!!! Important note regarding camera support !!!!**    
The ring-mqtt project does not magically turn Ring cameras into 24x7/continuous streaming CCTV cameras.  Ring cameras are designed to work with Ring cloud servers for on-demand streaming based on detected events (motion/ding) or interactive viewing.  Even when using ring-mqtt, all streaming still goes through Ring cloud servers and is not local.  Attempting to leverage this project for continuous streaming is not a supported use case and attempts to do so will almost certainly end in disappointment, this includes use with NVR tools like Frigate or motionEye.

### Quick overview
Ring video streaming support is implemented by running a localhost instance of rtsp-simple-server.  For each camera discovered two separate RTSP paths are registered with the server using the following format:

Live Stream:  <camera_id>_live  
Event Stream: <camera_id>_event

To start a stream all that is required is to use any media client that support the RTSP protocol to connect to the given URL.  Behind the scenes the rtsp-simple-server uses an on-demand script to communicate via MQTT to ring-mqtt to instruct it when to start and stop the video stream.

The "live" path always starts a live view stream for the camera, while the "event" path starts a stream of a previously recorded event.  By default the event stream plays the most recently recorded motion event, however you can use the event select feature to select the most recent through the 5th most recent motion, ding (doorbells only), or on-demand recording event.  For more details see the event stream section below.

### Quick live stream configuration with Home Assistant
Due to the fact that MQTT is not a techonology built for streaming, the MQTT camera support in Home Assistant only supports still images updated at most every 10 seconds and it is not currently possible to have Home Assistant automatically discover the video streaming cameras via the MQTT integration.  Because of this, the video streaming cameras will need to be configured manually in configuration.yaml.  Home Assistant provides a signficant number of camera platforms that can work with RTSP streams, but this document will focus on the setup of the [Generic IP Camera](https://www.home-assistant.io/integrations/generic/) integration.

To setup the generic IP camera you will need to manually add entries to the Home Assistant configuration.yaml file.  How to do that is outside of the scope of this document so please read up on that if you are not familiar with editing Home Assistants configuration files.

Setting up a camera requires a basic entry like this at a minimum:
```
camera:
  - platform: generic
    name: <Your Device Name Here>
    still_image_url: <image_url>
    stream_source: <stream_url>
```

Thie "name" option is the name that the camera will appear as in the Home Assistant UI.  You can use a URL to any image for the still_image_url but the suggested configuraiton is to enable the snapshot feature in this addon and use the camera proxy API so you get a nice, automatically updating still image.  The configuration example below does exactly that, it shows how to use a value template to pull the current MQTT snapshot image using the Home Assistant camera proxy API.  Using this setup the picture glance card will display the most recent snapshot and simply clicking the image will open the video stream.

The stream_source is the URL required to play the video stream.  To make the camera setup as easy as possible, ring-mqtt attempts to guess the required entries and includes them as attributes in the camera info sensor.  Simply open the camera device in Home Assistant, select the Info sensor entity, and the open the attributes and there will be a stream source and still image URL entry that you can copy and paste to create your config.  Alternately, you can find the attributes using the Developer Tools portion of the UI and finding the info sensor entity for the camera.  While the addon makes efforts to guess the correct URL, because the addon runs as an entirely separate process from Home Assistant, it has limited infomration to build the exact URL so in many cases it will not be 100% correct.  When running as an addon on supervised HA, it does attempt to query the API to get more information, but it still may not get exact port and other data correct.

The following example uses a camera with the name "Front Porch" in the Ring app.  The MQTT discovered snapshot camera has a Home Assistant entity ID of **camera.front_porch_snapshot** and the camera device ID is **3452b19184fa** so the attributes in the info sensor are as follows:
```
Still Image URL: http://<MY_HA_HOSTNAME>:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}  
Stream Source:   rtsp://03cabcc9-ring-mqtt:8554/3452b19184fa_live
```
To create the generic IP camera for the live video stream, in the configuration.yaml, simple add the following lines:
```
camera:
  - platform: generic
    name: Front Porch Video
    still_image_url: http://<MY_HA_HOSTNAME>:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}
    stream_source: rtsp://03cabcc9-ring-mqtt:8554/3452b19184fa_live
```

Note that the still_image_url uses the guessed hostname and/or localhost.  This could work in some cases, but if SSL is enabled or the default default port has been changed, the correct URL may not be reflected here, simple use the Home Assistant base URL with the value template on the end and make sure there is no slash after the hostname or port.  For example, if the Home Assistant instance is accessed directly via https://myha.mydomain.local/ then the URL would be https://myha.mydomain.local{{ states.camera.front_porch_snapshot.attributes.entity_picture }}.  If SSL is in use, but is using self-signed certificates, or if the use of localhost or the IP address instead of the full HA hostname is desired, then the `verify_ssl: false` config option will likely need to be added as well.  This is because the SSL certificate will typically be bound to the HA instance full hostname so attempts to connect via localhost/IP address will cause invalid certificate warnings.

Once the configuraiton is saved, simply reload the configuration (generic IP camera entities can be reloaded without a full HA restart) and the new camera entities should appear.  These cameras can now be added to the dashboard via a Picture Glance card or any other card that supports cameras.  With no special configuration this should now provide a card that provides still image snapshots based on the addon snapshot settings, and then, with a click, open a window that starts a live stream of that camera.

The picture glance card is quite flexible and it's possible to add the additional camera entities to this card as well, like the motion, light and siren switches (for devices with those features) and the stream switch.  With this setup it's possible to see at a glance if any motion/ding event is active, see the latest snapshot from that event, see the light/siren/stream state, and a simple click opens the live stream.

### Event Stream
** Please note that use of this feature requires a Ring Protect plan that support video saving **

As mentioned above, this addon provides two separate paths for video streams, one that always provides a live stream, and a second that can stream a selected, previously recorded stream.  Camera setup for this feature is the same as above, but uses the "<camera_id>_event" path vs the live path in the previous example.

On startup the default event is set to the most recent motion (Motion 1) but the play back event can be selected using the Event Selector entity in Home Assistant or the equivalient MQTT command topic.  Each camera allows selecting from any of the last five motion, ding, or on-demand events (ding events are available only for doorbells).  For example, selecting "Ding 1" will cause the event stream to play back the recording of the most recent doorbell ding event, while selecting "Motion 3" would play back the 3rd most recently recorded motion event.  On-demand recording events occur any time a video stream is started for on-demand viewing without a motion/ding event.

When a recorded stream is playing it is streamed only a single time for each RTSP client request and then the stream shuts down until the next request for a stream.  Stream playback can be manually stopped via the event stream switch, although note that, unlike live streams, playback of recorded events can only be started via on-demand viewing.

If a recorded stream is actively playing, changing the event selector immediately cancels playback of the existing event stream and the stream will not start again until a new client makes an RTSP request (for example, just closing and re-opening the playback window in Home Assistant).

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

`rtsp://streaming_user:let_me_stream!@3ba32cf2-ring-mqtt:8554/3452b19184fa_live`

### Manually Starting a Live Stream
When a media client connects to the live stream server the stream is started automatically, however, there may be cases where starting a stream without a media client is desired.  When used with a Ring Protect plan all live streams also create a recording so being able to manually start a stream allows an automation to effectively manually start and stop a recording.  This is possible ising the "live stream" switch, which is exposed as an entity to Home Assistant and can be accessed by MQTT as well.  It performs like any switch, accepting "ON" and "OFF" to start and stop a stream repsectively.

Note that turning the stream off ALWAYS stops the local live stream immediately, no matter how many clients are connected to the local RTSP server.

### Downloading recorded videos using the Event Stream
If this addon is used with an account that includes a Ring Protect Plan that supports saving videos to the Ring Cloud service, it is possible to use this addon to automate downloading of videos once they have been processed.  To assist with this, the "Select Event Stream" entity includes attributes for both the current eventId and the recordingUrl.

Note that recordingURLs are only valid for 15 minutes so the addon automatically requests a new URL around the 10 minute mark prior to the old URL expiring.  Also, any time a new event stream is selected the eventId and recordingUrl are immediately updated with the information for the selected event.  This means it's not a good idea to trigger downloads specifically on eventID changes.

As an alternetive, the best method is to use an automation that triggers on the event type being downloaded, then use a wait for trigger to perform the download as soon as the eventId changes.  Below is a simple example automation that uses the Home Assistant downloader service to download a recording as soon as the eventId is updated, which indicates that the recording is ready.

```
alias: Download Ring Video (Front Porch)
trigger:
  - platform: state
    entity_id: binary_sensor.front_porch_motion
    to: 'on'
action:
  - wait_for_trigger:
      - platform: state
        entity_id: select.front_porch_event_select
        attribute: eventId
    timeout: '00:05'
  - service: downloader.download_file
    data_template:
      url: '{{ states.select.front_porch_event_select.attributes.recordingUrl }}'
      subdir: front_porch
      filename: '{{ now().strftime( ''%Y%m%dT%H%M%S_motion.mp4'' ) }}'
      overwrite: false
```

The automation in this example is initially triggered any time a motion event starts.  Once triggered, it waits for the eventId attribute to change, which indicates that te recording of the new event is ready. At that point it uses the Home Assistant downloader service with the recordingUrl attribute to download the file to a subdirectory with a date based filename.

Of course there are other possible automation options as well, and, even without a Ring Protect Plan, you can do things like start an FFmpeg stream on a motion event to record a video, however, the Ring Protect Plan still offers a significant value in that it pulls the seconds just before the event, while triggering a recording of the stream will always miss the first few seconds at least since it won't know to start recording until after the motion event is received.  If course, if you are using other devices or events as the start trigger, this might be good enough.

### FAQ

**Q) Why do streams keep running for 5+ minutes after viewing them in Home Assistant**  
**A)** Home Assistant keeps streams running in the background for ~5 minutes even when they are no longer viewed.  It's always possible to stop streams manually using the stream switch.

**Q) Streams keep starting all the time even when I'm not viewing anything**  
**A)** In Home Assistant, do not use the "Preload Stream" option and make sure the Camera View setting in the Picture Glance card is set to "auto" instead of "live".  Otherwise the card will attempt to start streams in the background for faster startup when you bring up the card.  This is fine for local cameras but, because Ring cameras do not send motion events during streams, having streams running all the time will cause motion events to be missed and, since all streaming goes through Ring servers on the Internet, you will use a lot of bandwidth as well.

**Q) Why does the live stream stop after ~10 minutes?**  
**A)** Ring enforces a time limit on active live streams and terminates them, typically at approximately 10 minutes, although sometimes significantly less and sometimes a little more.  Currently, you'll need to refresh to manually start the stream again but it is NOT recommended to attempt to stream 24 hours.  I say currently because Ring has hinted that continuous live streaming is something they are working on, but, for now, the code honors the exiting limits and does not just immediately retry.

**Q) Why is the stream delayed/lagged?**  
**A)** Likely this is due to the streaming technology used by Home Assistant that fully streams over HTTP/HTTPS.  While the technology is extremely reliable and widely compatible with various web browsers and network setups, it typically adds betwee 5-8 seconds of delay and sometimes as many as 10-15 seconds.  The best solution for Home Assistant is to use a custom UI card like the excellent [WebRTC Camera](https://github.com/AlexxIT/WebRTC) which will allow you to use your browsers native video playback capabilities, although this technology will likely require special configuration if you want to play back while outside of your network without using a VPN.  However, when configured, it provides typically ~1-2 seconds of latency at most so it's the best option for getting as close to real-time viewing as possible within Home Assistant.  Other options that offer lower latency viewing is to use an external media player capable of RTSP playback.  VLC works well, but note that it buffers 1 second of video by default, although you can tweak this to reduce the delay.

**Q) Why do I have video artifacts and/or stuttering in the stream?**   
**A)** There are two likely sources of artifacts/stuttering, I'll outline both below:
- Ring streams seems to include a signficant number of minor encoding errors, especially at the start of streams, but I'm not really sure why.  At first I thought this was a bug in the ring-client-api RTP handling, but then I realized that the same artifacts were completely reproducible when playing back the recorded videos downloaded from Ring, even if you feed them directly into Home Assistant via the FFmpeg camera source.  More interestingly, the stutters and pauses were always in the exact same places.  Attempting to decode the file with FFmpeg produced lots messages about minor decoding errors, however, if you view the same file in a media client like VLC, the artifacts seem very minor, even difficult to see in some case, but are much more obvious in the Home Assistant video playback.  I believe the reason they are more pronounced in Home Assistant is due to the way Home Assistant converts the incoming AVC stream to HLS on the fly.  My understanding is that, to save CPU since Home Assistant commonly runs on fairly low powered device, the stream component does not transcode the incoming stream, but simply chops the stream on I-frame boundaries to convert them to HLS segments.  It seems this process amplifies the impact of these minor encoding errors.  While it's possible to transcode the stream with ffmpeg within ring-mqtt, the cost is far higher CPU usage so for now I'm just feeding the stream as is and living with the minor stuttering that usually happens mostly in the first few seconds of the recording.
- The second issue mostly impacts the live stream because the live stream uses UDP to send RTP streams and these streams are processed by ring-client-api inside of the NodeJS process before being sent via a pipe to ffmpeg.  While Node is quite fast for an interpreted language like Javascript, it's still not exactly the most efficient for real-time stream processing so you need a reasonable amount of CPU available.  Having a good CPU and a solid networking setup that does not drop UDP packets is critical to reliable function of the live stream.  If you have mulitple cameras, or a system with limited CPU/RAM (RPi3 for example) then you should limit concurrent live streams to just a few at a time for the most stable video.  In my testing a RPi3 struggles to support more than about 4 concurrent live streams, an RPi4 can handle about 6 concurrent live streams, and a decent Intel based machine can handle about 2-3 live streams per-core.  These numbers assume that the load on the CPU from other components is minimal.

**Q) Why do I see high memory usage?**  
**A)** Support for live streaming uses rtsp-simple-server, which is a binary process running in addition to the normal node process used by ring-mqtt.  When idle, this process uses quite minimal memory (typically <20MB).  However, every stream has at least one FFmpeg process to read the incoming stream and publish it to the server.  Total memory usage is typically about 25-30MB per each active stream on top of the base memory usage of the addon.  Also, when using Home Assistant, the Home Assistant memory usage will also increase for each stream.

**Q) Why are there no motion events while live streaming?**  
**A)** This is a limitaiton of Ring cameras as they do not detect/send motion events while a stream/recording is active.  The code itself has no limitations in this regard.

**Q) Why do I have so many recordings on my Ring App?**  
**A)** If you have a Ring Protet subscrition then all "live streams" are actually recording sessions as well, so every time you start a live view of your camera you will see a recording in the Ring app.

### How it works - the gory details
The concept for streaming is actually very simple and credit for the original idea must go to gilliginsisland's post on the [ring-hassio project](https://github.com/jeroenterheerdt/ring-hassio/issues/51).  While I was already working on a concept implementation for ring-mqtt, when I read that post I realized that it was actually a strong model that could be married with ring-mqtt to support live streaming in a way that made a lot of sense.  The post described a method to use rtsp-simple-server and it's ability to run a script on demand to directly run a node instance that leveraged ring-client-api to connect to Ring and start the live stream.  Since ring-mqtt already ran in node and used ring-client-api, and already contained code for starting streams, I decided that instead of starting a separate node script, which had high startup and memory overhead, I could just have rtsp-simple-server start a simple shell script that used MQTT to signal ring-mqtt to start the stream on demand while also allowing streams to be started and stopped manually via MQTT commands.

Digging more into rtsp-simple-server, I found that it not only had the ability to run a script on demand, but also included a simple REST API that meant it could be configured and controlled dynamically from the exiting ring-mqtt node instance.  Below is the general workflow:

1) During startup, ring-mqtt checks to see if camera support is enabled and, if so, spawns and monitors an rtsp-simple-server process.
2) After device discovery, ring-mqtt leverages the rtsp-simple-server REST API to register the RTSP paths with an on-demand script handler that will pass the proper MQTT topic information for each path as environment variables.
3a) A stream is started by any media client connecting to the RTSP path for the camera (rtsp://hostname:8554/<camera_id>_live or hostname:8554/<camera_id>_event).
-- or --
3b) The command to manually start a stream is received via MQTT.  In this case ring-mqtt internally starts a small FFmpeg process that connects as an RTSP client to trigger the on-demand stream.  This process does nothing but copy the audio stream to null, just enough to keep the stream alive while keeping CPU usage extremely low.  
4a) If an existing stream is already active and publishing to the requested path, the client simply connects to the existing stream in progress
-- or --
4b) If there is not currenty an active publisher for that stream, rtsp-simple-server runs a shell script which sends commands via MQTT to start the script and monitor the progress as ring-mqtt starts the stream.  Since this is just a simple script sending a single MQTT command to an already running process, the startup process is fast and lightweight as ring-mqtt already has a connection to the Ring API and the communication channel with MQTT is local and takes only a few ms.  Usually the live stream starts in ~2-3 second although buffering by the media client usually means the stream takes a few seconds longer to actually appear in the UI or media client.  
5) The RTSP server continues to stream to the clients, once the stream times out on the Ring side, or the last client disconnects, rtsp-simple-server stops the on-demand script, which sends the MQTT command to stop the stream prior to exiting.

The overall process is fairly light on CPU and memory because the ffmpeg process that is receiving the stream is only copying the existing AVC video stream to the RTSP server with no modification/transcoding.  The only transcoding is of the audio stream because the primary stream is G.711 μ-law while the Home Assistant stream component is compatible with AAC so the FFmpeg process does create and stream a second AAC based audio channel for maximum compaiblity (players can choose the stream with which they are compatible).
