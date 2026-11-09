## v6.0.0
This new major version of ring-mqtt includes an entirely re-written video streaming pipeline using a custom Ring WebRTC-to-RTSP gateway service written in go providing support for native H.265 2K/4K streams and overall higher bitrates while using significantly less CPU and memory resources on the host.

Camera devices now provide a Video Mode selector to control the requested codec. By default, cameras remain in `Compatible` mode, which will always request H.264/AVC streams and is by far the most compatible across all OS and browser combinations.  However, users can now select `Optimal` mode, which will request an H.265/HEVC stream for cameras that indicate support for HEVC.

Using H.265/HEVC for cameras that support it (most modern Ring cameras, especially those with 2K/4K support) provides the absolute best video quality but playback support depends entirely on the combination of browser and OS capability.  Not all browsers support H.265 (Edge/Firefox), while some other combinations (Chrome on Windows/Linux) depend on hardware decoders which are much more sensitive to packet loss.

Currently, using H.265/HEVC RTSP streams in HA can be unreliable due to a bug in go2rtc and how it processes ffmpeg stream processing, which HA always uses when setting up go2rtc with an RTSP source.  Due to this, if you want reliable viewing of native H.265/HEVC for viewing in HA, you'll need to follow the instructions to [install and configure a patched go2rtc addon](https://github.com/tsightler/ring-mqtt/wiki/Video-Streaming#home-assistant-instability-with-h265hevc-rtsp-streams) to override the embedded go2rtc included in the HA platform. 

In addition to the new stream protocols, the new code no longer depends on the upstream ring-client-api. The new local API implementation is simpler and has been modified to use newer Ring v3 API for location and device discovery which is required for some newer devices as well as the new shared permissions model for devices using shared locations/accounts.

**New Features**
 - Support all known wired and battery Kidde Smoke and Smoke/CO alarm variants.
   Thanks to @ithinkdancan for the PR.
 - Include rich notification and CV metadata (`detectionType`, `motionTitle`,
   `motionDescription`, and `personName`) in camera motion sensor attributes.

**Changes**
 - Publish MQTT discovery and state messages with the `retain` flag enabled,
   removing the need for repeated republish loops on startup and Home Assistant
   restarts, and automatically clean up stale retained discovery and state
   topics when entities or devices are removed
 - Use the Ring v3 API for device health and camera event history queries, and
   handle failed health queries gracefully so they cannot prevent a device from
   being published
 - Back off on repeated camera ding/motion subscription failures and skip
   subscription attempts on shared cameras that lack alert management permission
 - Standardize uninitialized device attributes to `null` instead of placeholder
   strings across cameras and security panels
 - Exclude `ring-disc` and `ring-push` debug namespaces from the `ring-*`
   wildcard so they are only enabled when explicitly specified in `DEBUG`, and
   summarize ignored startup push notifications into a single log entry
 - Update Docker base image to `node:krypton-alpine` (Node 24 LTS), `s6-overlay`
   `v3.2.3.2`, and `bashio` `v0.19.0`, and drop 32-bit ARM (`armv7`/`armhf`)
   image builds

**Bugs Fixed**
 - Fix a race condition during initial discovery where device state, ding, or
   snapshot messages could be published before entity topics were created
 - Fix incorrect attribute names (`ArmedBy`/`ArmedTime` -> `lastArmedBy`/
   `lastArmedTime` and `DisarmedBy`/`DisarmedTime` -> `lastDisarmedBy`/
   `lastDisarmedTime`) when updating security panel armed/disarmed event
   attributes
 - Fix Intercom lock command using comparison (`===`) instead of assignment
   (`=`), preventing the lock state from updating to `LOCKED`
 - Fix `URLSearchParams` parsing of recording URLs when calculating camera
   event stream URL expiration
 - Fix operator precedence bug when checking camera ding and motion
   subscription status
 - Fix crash when checking `lite_24x7` snapshot frequency on cameras without
   `lite_24x7` settings
 - Fix Chime snooze minutes range validation (`1-1440` minutes)
 - Fix location WebSocket disconnect handler marking non-socket devices offline
 - Prevent duplicate Express route registration if the Web UI service restarts
 - Build the snapshot entity id in the still_Image_URL attribute the same way
   Home Assistant does.  Thanks to @matiasmacera for the PR.
 - Fix searching for person events only checking the first page of event
   history.  Thanks to @matiasmacera for the PR.
 - Reject snapshot mode commands that don't match one of the available
   options.  Thanks to @matiasmacera for the PR.
 - Restore a manually set snapshot interval after a restart.  The interval
   was saved but never read back, and a manual interval setting was also
   reset to automatic on every restart.  Thanks to @matiasmacera for the PR
 - Mask livestream credentials in camera attribute debug logs and the alarm
   disarm code in discovery debug logs.  Thanks to @matiasmacera for the PRs.
 - Pass livestream credentials to the stream helper via environment variables
   rather than command-line arguments. Thanks to @matiasmacera for the PR.
 - Sync restClient.authConfig when updating restClient.refreshToken. Thanks
   to @loganrosen for the PR
 - Fall back to a direct file write when saving the state file fails with
   EPERM on filesystems with restrictive ACLs such as ZFS on TrueNAS or
   Synology NAS.  Thanks to @don4of4 for the PR
 - Wait for async attribute entity setup to complete before publishing device
   discovery so slow device health or event history lookups cannot cause
   missing entities or attributes at startup.  Thanks to @davimount for the PR

**Dependency Updates**
 - Removed `@tsightler/ring-client-api` in favor of embedded Ring API client
   (using `@eneris/push-receiver` 4.4.0, `json-bigint` 1.0.0, and `undici` 8.12.4)
 - Removed aedes, no longer needed now that the internal MQTT broker is gone
 - Removed @homebridge/camera-utils and werift, no longer needed now that
   WebRTC sessions are handled by ringstream helper
 - Removed the go2rtc binary, the mosquitto clients and jq from the image
 - Added ws 8.22.2 for the helper control socket
 - Added ffmpeg-for-homebridge 2.2.2
 - body-parser 2.4.0
 - chalk 6.0.1
 - date-fns 4.4.0
 - express 5.3.0
 - js-yaml 5.5.0
 - mqtt 5.16.1
 - write-file-atomic 8.0.0

### Changes prior to v6.0.0 are tracked in the [historical changelog](https://github.com/tsightler/ring-mqtt/blob/main/docs/CHANGELOG-HIST.md)
