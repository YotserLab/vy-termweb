package main

import (
	"io"
	"net"
	"sync"
	"time"

	siosocket "github.com/zishang520/socket.io/v2/socket"
	"golang.org/x/crypto/ssh"
)

const (
	parkTTL       = 60 * time.Second
	scrollbackMax = 128 * 1024
)

// localPty abstracts creack/pty (unix) and conpty (windows).
type localPty interface {
	io.Writer
	Resize(cols, rows int) error
	Close() error
}

type tunnelSpec struct {
	ID         string `json:"id"`
	LocalPort  int    `json:"localPort"`
	RemoteHost string `json:"remoteHost"`
	RemotePort int    `json:"remotePort"`
	Type       string `json:"type"`
}

// TermSession mirrors the Node implementation: SSH/PTY/SFTP state that can be
// parked on transport disconnect and resumed by resumeId.
type TermSession struct {
	ResumeID    string
	Resumable   bool
	Conn        *ssh.Client
	SSHSession  *ssh.Session
	SSHStdin    io.Writer
	SFTP        sftpLike
	SFTPFailed  bool
	SFTPPending bool
	Pty         localPty
	Log         *sessionLog
	Hops        []*ssh.Client // intermediate jump-host connections
	Tunnels     []net.Listener
	Remote      []net.Listener // ssh remote-forward listeners
	Scrollback  string
	Cols        int
	Rows        int
	Sock        *siosocket.Socket
	Dead        bool
	ParkTimer   *time.Timer
	done        chan struct{}
	mu          sync.Mutex
}

func (s *TermSession) pushData(data string) {
	s.mu.Lock()
	s.Scrollback += data
	if len(s.Scrollback) > scrollbackMax {
		s.Scrollback = s.Scrollback[len(s.Scrollback)-scrollbackMax:]
	}
	sock, logw := s.Sock, s.Log
	s.mu.Unlock()
	if logw != nil {
		logw.write(data)
	}
	if sock != nil {
		sock.Emit("ssh-data", data)
	}
}

func (s *TermSession) emit(ev string, args ...any) {
	s.mu.Lock()
	sock := s.Sock
	s.mu.Unlock()
	if sock != nil {
		sock.Emit(ev, args...)
	}
}

var (
	termSessions   = map[string]*TermSession{}
	termSessionsMu sync.Mutex
)

func newTermSession(resumeID string, sock *siosocket.Socket) *TermSession {
	s := &TermSession{
		ResumeID:  resumeID,
		Resumable: resumeID != "",
		Sock:      sock,
		done:      make(chan struct{}),
	}
	if resumeID == "" {
		s.ResumeID = "socket-" + string(sock.Id())
	}
	termSessionsMu.Lock()
	termSessions[s.ResumeID] = s
	termSessionsMu.Unlock()
	return s
}

func destroyTermSession(s *TermSession) {
	termSessionsMu.Lock()
	if termSessions[s.ResumeID] == s {
		delete(termSessions, s.ResumeID)
	}
	termSessionsMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ParkTimer != nil {
		s.ParkTimer.Stop()
		s.ParkTimer = nil
	}
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	if s.Pty != nil {
		s.Pty.Close()
		s.Pty = nil
	}
	for _, l := range s.Tunnels {
		l.Close()
	}
	s.Tunnels = nil
	for _, l := range s.Remote {
		l.Close()
	}
	s.Remote = nil
	if s.Log != nil {
		s.Log.close()
		s.Log = nil
	}
	for _, h := range s.Hops {
		h.Close()
	}
	s.Hops = nil
	if s.SFTP != nil {
		s.SFTP.Close()
		s.SFTP = nil
	}
	if s.SSHSession != nil {
		s.SSHSession.Close()
		s.SSHSession = nil
	}
	if s.Conn != nil {
		s.Conn.Close()
		s.Conn = nil
	}
}

// tryResume reattaches a parked session to a new socket. seen = chars already
// rendered by the client (<0 disables replay).
func tryResume(resumeID string, seen int, sock *siosocket.Socket) *TermSession {
	if resumeID == "" {
		return nil
	}
	termSessionsMu.Lock()
	s := termSessions[resumeID]
	termSessionsMu.Unlock()
	if s == nil {
		return nil
	}
	s.mu.Lock()
	if s.Dead {
		s.mu.Unlock()
		destroyTermSession(s)
		return nil
	}
	if s.ParkTimer != nil {
		s.ParkTimer.Stop()
		s.ParkTimer = nil
	}
	s.Sock = sock
	scrollback := ""
	if seen >= 0 && seen < len(s.Scrollback) {
		scrollback = s.Scrollback[seen:]
	}
	ready := s.SSHSession != nil || s.Pty != nil
	hasSFTP := s.SFTP != nil
	retrySFTP := s.SFTPFailed && !s.SFTPPending
	conn := s.Conn
	s.mu.Unlock()

	sock.Emit("ssh-resumed", map[string]any{"scrollback": scrollback, "ready": ready})
	if hasSFTP {
		sock.Emit("sftp-ready")
	} else if retrySFTP && conn != nil {
		// SFTP init failed before the disconnect — retry on resume
		s.mu.Lock()
		s.SFTPPending = true
		s.mu.Unlock()
		go initSFTP(s)
	}
	return s
}

func parkOrDestroy(s *TermSession, sock *siosocket.Socket) {
	s.mu.Lock()
	if s.Sock != sock {
		s.mu.Unlock()
		return
	}
	s.Sock = nil
	if s.Resumable && !s.Dead {
		s.ParkTimer = time.AfterFunc(parkTTL, func() { destroyTermSession(s) })
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	destroyTermSession(s)
}
