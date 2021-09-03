## Camera Live Streaming
While ring-mqtt is primarily designed to integrate Ring devices into home automation platforms via MQTT to allow driving automations from Ring devices, there was high demand to provide live streaming integration as well, especially for Home Assistant users, but also to provide things like on-demand recording so, for example, you can trigger a recording event on a camera based on an automation triggered from non-Ring devices.

Because of this demand ring-mqtt 4.8 has introduced support for live video streaming, this document provides details and FAQs about the live streaming support, how to configure it, how to troubleshoot it, as well as information on known limitations.  If you would like to use the live streaming feature, please read this section carefully.

### Quick configuration with Home Assistant
Because live streaming isn't supported by MQTT, it is not currently possible to have Home Assistant automatically discover the Ring live streaming cameras, they will need to be manually configured.  Home Assistant provides a signficant number of camera platforms that can work with RTSP streams, but this method will focus on the setup of the [Generic IP Camera](https://www.home-assistant.io/integrations/generic/).  To setup the generic IP camera you will need to manually add entries to the configuration.yaml file.  How to do that is outside of the scope of this document so please read up on that if you are not familiar with editing Home Assistants configuration files.

Setting up a camera require a basic entry like this at a minimum:
```
camera:
  - platform: generic
    name: <Your Device Name Here>
    still_image_url: <image_url>
    stream_source: <stream_url>
```

Name is the name you want your camera to appear as in the Home Assistant UI.  The still_image_url can be a changing image, so in the configuration below we will use a template to pull the current snapshot image delivered via MQTT.  The stream_source is the URL required to play the video.  To make the setup of this as easy as possible ring-mqtt attempts to guess the required entries and send them as attributes in the camera info sensor.  Find the camera device in Home Assistant, select the Info sensor entity, and the open the attributes and there will be a stream source and still image URL entry that you can copy and paste to create your config.

In my example I'm setting up a live stream camera for my front porch, which has a Home Assistant entity ID of ```camera.front_porch_snapshot``` and the camera device ID is 3452b19184fa so the attributes in the info sensor are as follows:  

Still Image URL:  http://localhost:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}
Stream Source:  rtsp://3ba32cf2-ring-mqtt-dev:8554/3452b19184fa_live

To create my generic IP camera in configuration.yaml I just need these lines:
```
camera:
  - platform: generic
    name: Front Porch Live
    still_image_url: http://localhost:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}
    stream_source: rtsp://3ba32cf2-ring-mqtt-dev:8554/3452b19184fa_live
```

Once saved I reload the configuration (generic IP camera entities can be reloaded with a full restart) and I should see a new camera which can now be added to the Lovelace Dashboard via a Picture Glance card.  With no special configuration this should now provide a card that provides still image snapshots based on your snapshot settings, and then, with a click, you can start a live stream of that camera.

I usually like to add the other camera entities to this card as well, like the motion, light and siren switches (for devices with those features) and the stream switch.  This way I can tell at a glance if there is a motion event, if it's something interesting, and just click to start a live stream if I want a live view.

### Authentication
By default, the addon does not expose the RTSP server to external devices so only Home Assistant can actually access the streams, thus using a non-authenticated stream isn't too bad since the stream stays completely internal to the Home Assistant server, however, if you want to access the stream via other media clients (like VLC for example) or your simple feel better with a username and password, you can set one in the configuration using the livestream_user/livestream_pass configuraiton options (LIVESTREAMUSER/LIVESTREAMPASSWORD environment variables for standard Docker installs).  If the RTSP port is exposed setting a username/password is HIGHLY recommended.  Note that currently, even with a username and password, the stream is not encrypted, so using the stream over an untrusted network without a VPN is probably not a good idea.

If you set a username and password both publishers and streamers will use this password.  Note that this is handled automatically for the stream publihsing, but for your camera entities in Home Assistant, you will need to add the approriate settings to configuraiton.yaml.  A sample is as follows:

```
camera:
  - platform: generic
    name: Front Porch Live
    still_image_url: http://localhost:8123{{ states.camera.front_porch_snapshot.attributes.entity_picture }}
    stream_source: rtsp://3ba32cf2-ring-mqtt-dev:8554/3452b19184fa_live
    username: "streaming_user"
    password: "let_me_stream!"
```

### External RTSP Access
To allow streaming to external media clients you'll need to open the port for the RTSP server either via the addon configuration settings or via the Docker -p port forwarding option.  It's recommended to use TCP port 8554, but you can actually forward any external TCP port to the 8554 on the RTSP server in the container.  Note that streams will start automatically on-demand, and end ~5-10 seconds after the last client disconnects.  Multiple clients can connect to the same stream concurrently.  No MQTT access is needed for this to work, simply enter the RTSP URL into your media player.  If you defined a livestream username and password this will need to be included as well, most player will prompt for a username/password, but some require them to be included in the URL, for example:

rtsp://streaming_user:let_me_stream!@3ba32cf2-ring-mqtt-dev:8554/3452b19184fa_live

### FAQ

Q) Why does my stream stop after no more than 10 minutes?
A) Ring limits active streams and terminates them on their side, typically at approximately 10 minutes, although sometimes significantly less and sometimes a little more.  Currently, you'll need to refresh to manually start the stream again but it is NOT recommended to attempt to stream 24 hours.  I say currently because Ring has hinted that continuous live streaming is something they are working on, but currently, I'm honoring their limits as otherwise they may block access.

Q) Why do I not receive motion events while I am live streaming
A) This is a limitaiton of Ring cameras, they do not send events while streaming

Q) Why is the stream delayed/lagged?
A) Likely this is due to the streaming technology used by Home Assistant that fully streams over HTTP/HTTPS.  While the technology is extremely reliable and widely compatible with various web browsers and network setups, it typically adds betwee 4-6 seconds of delay and sometimes as many as 10-15 seconds.  The best solution for Home Assistant is to use a card like the excellent [WebRTC Camera](https://github.com/AlexxIT/WebRTC) which will allow you to use your browser native stream player capabilities, although this technology will like require special configuration if you want to play back while outside of your network without using a VPN.  However, it provides typically 1 second or less delay (can be as little as .5 seconds) so it's the best option when available.

Q) Why do I have so many recording on my Ring App?
A) Ring "live streams" are actually recording sessions as well, so every time you start a live view of your camera you will get a recording on Ring.

Q) Can I manually start the stream?
A) Yes, you can manually start the live stream using the stream switch in Home Assistant or by using the MQTT commands.  Since all live streams in Ring are recorded, this allows cool things like starting a recording based on other events.

Q) Can I manually stop the stream?
A) Streaming should end automatically 5-10 seconds after the last client stops viewing, however, you can manually cancel the stream with the stream switch or by using the MQTT command.
