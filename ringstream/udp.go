package main

import (
	"fmt"
	"log"
	"net"
	"sync"

	"github.com/pion/rtp"
)

// freeUDPPortPair finds an even port whose successor is also free, because the
// sdp demuxer binds RTP on the port and RTCP on the one above it.
func freeUDPPortPair() (int, error) {
	for i := 0; i < 100; i++ {
		c, err := net.ListenPacket("udp", "127.0.0.1:0")
		if err != nil {
			return 0, err
		}
		port := c.LocalAddr().(*net.UDPAddr).Port
		_ = c.Close()

		if port%2 != 0 {
			continue
		}
		next, err := net.ListenPacket("udp", fmt.Sprintf("127.0.0.1:%d", port+1))
		if err != nil {
			continue
		}
		_ = next.Close()
		return port, nil
	}
	return 0, fmt.Errorf("no free udp port pair")
}

// sanitize strips the parts of a WebRTC RTP header that have no meaning over
// plain RTP. Header extensions and CSRCs are noise to ffmpeg, and a padding bit
// left set after pion has already removed the padding bytes makes receivers trim
// real payload off the end of the packet.
func sanitize(pkt *rtp.Packet) *rtp.Packet {
	out := *pkt
	out.Header.Extension = false
	out.Header.ExtensionProfile = 0
	out.Header.Extensions = nil
	out.Header.CSRC = nil
	out.Header.Padding = false
	out.PaddingSize = 0
	return &out
}

// udpTrack sends RTP to one of ffmpeg listening ports.
//
// The socket is left unconnected on purpose: ffmpeg takes a moment to parse the
// SDP and bind, and a connected socket would surface that as ICMP "connection
// refused" on every write until it does.
type udpTrack struct {
	lg *log.Logger

	conn *net.UDPConn
	addr *net.UDPAddr
	name string

	mu     sync.Mutex
	closed bool
	warned bool
}

func dialUDP(lg *log.Logger, name string, port int) (*udpTrack, error) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 0})
	if err != nil {
		return nil, err
	}
	return &udpTrack{
		lg:   orDefault(lg),
		conn: conn,
		addr: &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port},
		name: name,
	}, nil
}

// write never reports an error to the caller: a failed datagram is a dropped
// packet, not a reason to end the stream.
func (t *udpTrack) write(pkt *rtp.Packet) error {
	if t == nil {
		return nil
	}
	buf, err := sanitize(pkt).Marshal()
	if err != nil {
		return err
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil
	}
	if _, err := t.conn.WriteToUDP(buf, t.addr); err != nil && !t.warned {
		t.warned = true
		t.lg.Printf("udp write to %s: %v (further occurrences suppressed)", t.addr, err)
	}
	return nil
}

func (t *udpTrack) close() {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	t.closed = true
	if t.conn != nil {
		_ = t.conn.Close()
	}
}
