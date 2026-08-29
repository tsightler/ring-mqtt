# ringstream

`ringstream` terminates a Ring WebRTC live (or event) session and republishes it
to a local RTSP server, so Home Assistant, go2rtc, an NVR, or any RTSP client can
consume a Ring camera as an ordinary RTSP stream. It replaces the old
werift + ffmpeg + shell-script pipeline.

RTP is passed through untouched wherever possible — Ring's own payload and
timestamps survive end to end — but a WebRTC stream is not the same thing as an
RTSP stream, and the gap between them is where the processing below lives. Each
item exists to solve a specific, observed failure; none of it is speculative.

## How a session is set up

1. **Parameter-set collection** (`params.go`). An RTSP track description must
   carry VPS/SPS/PPS (HEVC) or SPS/PPS (H.264) up front, but Ring only sends them
   in-band alongside each keyframe. The collector reads forward until it has a
   complete set, anchored on the **start** of a parameter-set run (the VPS for
   HEVC, the SPS for H.264) rather than on the random-access flag — Ring flags
   each of VPS/SPS/PPS individually, so anchoring on the flag alone can capture a
   partial set and start the stream on undecodable data.

2. **Pre-roll drain.** Ring hands over a backlog when a session opens — several
   seconds of it on a doorbell. Forwarding it all at line rate is a burst far
   beyond what a consumer bringing up a decoder can absorb. ringstream drains the
   backlog and re-anchors on the **newest** complete keyframe, so playback starts
   near the live edge instead of seconds in the past.

3. **Reader-ready gate** (`waitReady`, `server.go`). When serving readers
   directly, the RTSP server delivers only to whoever is attached at the time of
   a write and keeps no history. Publishing the opening keyframe before a reader
   has finished RTSP `SETUP`/`PLAY` would send it to nobody, and the reader would
   join mid-GOP on frames it cannot decode. The session waits (briefly) for the
   first reader before replaying the keyframe.

4. **Keyframe gate + PLI** (`main.go`, `keyframe.go`). Video is held until a
   random-access point has been forwarded, and a Picture Loss Indication is sent
   to Ring at startup (and retried) so the first keyframe arrives promptly rather
   than on Ring's ~2-second cadence. A decoder is never handed slices that
   reference pictures it never received.

## How packets are processed in flight

5. **Header sanitisation** (`sanitize`, `udp.go`). WebRTC RTP header extensions,
   CSRC lists, and the padding bit are meaningless over plain RTP; a padding flag
   left set after the bytes were already removed makes receivers trim real
   payload off the end of a packet. These are stripped.

6. **NACK / RTX loss recovery** (`main.go`). The peer connection advertises and
   honours NACK with RTX, so lost packets on the Ring → ringstream leg can be
   retransmitted. This loss is otherwise invisible to everything downstream — a
   gap reaches a decoder as an access unit that looks complete and is not.

7. **Adaptive reorder buffer** (`reorder.go`). A retransmission is useless if the
   stream has already moved past the packet it repairs, so a sequence gap is held
   open briefly to let the repair arrive, then released in order. The wait is
   **not** a fixed value: it is estimated from measured repair latency the way TCP
   estimates a retransmission timeout (RFC 6298, mean + 4×variance), bounded
   between a floor and a ceiling (`-reorder-wait` / `-reorder-max`, default
   50 ms–400 ms). A camera on the LAN sits at the floor and adds no latency; a
   camera on another continent, where a NACK round trip runs to a few hundred
   milliseconds, climbs toward the ceiling only as far as its repairs actually
   need. In-order packets are released immediately, so there is no steady-state
   latency cost — the wait applies only while a gap is open.

8. **Loss resync to a keyframe** (`resync.go`). When a gap cannot be repaired in
   time, resuming at the next access-unit boundary is not enough: every frame
   after the gap references pictures that went missing with it, and a hardware
   decoder handed those dies rather than degrading. ringstream instead drops
   everything until the next keyframe — the same thing a browser does with the
   same loss. The cost is a freeze of up to one GOP; the alternative is a decoder
   that never recovers. Sequence numbers are never rewritten, so consumers that
   handle loss themselves still see the gap and discard the damaged frame.

9. **A/V timestamp synchronisation** (`rtcpclock.go`). Video (90 kHz) and Opus
   (48 kHz) count from independent random offsets; nothing in the RTP header
   relates them. The only thing that does is the NTP↔RTP mapping in an RTCP
   sender report. ringstream reads Ring's sender reports per track and stamps
   outgoing RTSP packets with the derived capture time (`WritePacketRTPWithNTP`),
   so a downstream consumer can line audio up against video. Without this, the
   two tracks drift by whatever their arrival delays differ by.

## Notes

- The default transport publishes Ring's packets directly to the RTSP server;
  ffmpeg is not in the live path. ffmpeg is still used to play recorded events
  and to transcode HEVC event downloads with a short GOP.
- Everything above is exercised by unit tests alongside each file
  (`*_test.go`) — the reorder budget, the resync keyframe logic, the parameter
  collector, the NTP clock, and the read-timeout handling in particular.

