package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	siosocket "github.com/zishang520/socket.io/v2/socket"
)

// Session logging — drains pushData output into a file under
// ~/.vy-termweb/logs/. "clean" strips ANSI/OSC escape sequences; "raw" keeps
// the byte stream as received.

var ansiStrip = regexp.MustCompile(
	"\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)" + // OSC ... BEL or ST
		"|\x1b\\[[0-?]*[ -/]*[@-~]" + // CSI
		"|\x1b[@-Z\\\\-_]" + // 2-byte escapes
		"|\r",
)

type sessionLog struct {
	mu     sync.Mutex
	f      *os.File
	clean  bool
	closed bool
}

func logsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, ".vy-termweb", "logs")
}

func logFileName(resumeID string) string {
	base := resumeID
	if base == "" {
		base = "session"
	}
	base = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			return r
		}
		return '-'
	}, base)
	return fmt.Sprintf("vytw-%s-%s.log", base, time.Now().Format("20060102-150405"))
}

// startSessionLog attaches a log file to the session. format: "clean"|"raw".
func startSessionLog(s *TermSession, format string) (string, error) {
	if format == "" || format == "off" {
		return "", fmt.Errorf("invalid log format %q", format)
	}
	if err := os.MkdirAll(logsDir(), 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(logsDir(), logFileName(s.ResumeID))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return "", err
	}
	l := &sessionLog{f: f, clean: format == "clean"}
	fmt.Fprintf(f, "=== VY-TermWEB session log started %s (format=%s) ===\n", time.Now().Format(time.RFC3339), format)
	s.mu.Lock()
	if s.Log != nil {
		s.Log.close()
	}
	s.Log = l
	s.mu.Unlock()
	return path, nil
}

func (l *sessionLog) write(data string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	if l.clean {
		data = ansiStrip.ReplaceAllString(data, "")
	}
	l.f.WriteString(data)
}

func (l *sessionLog) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		return
	}
	l.closed = true
	fmt.Fprintf(l.f, "\n=== log ended %s ===\n", time.Now().Format(time.RFC3339))
	l.f.Close()
}

// registerLogHandlers adds "ssh-log-start"/"ssh-log-stop" socket events so a
// session can start/stop logging at any time (not only on connect).
func registerLogHandlers(sock *siosocket.Socket, sessBox **TermSession) {
	sock.On("ssh-log-start", func(args ...any) {
		s := *sessBox
		if s == nil {
			return
		}
		var opts struct {
			Format string `json:"format"`
		}
		decodePayload(firstArg(args), &opts)
		if opts.Format == "" {
			opts.Format = "clean"
		}
		p, err := startSessionLog(s, opts.Format)
		if err != nil {
			s.emit("ssh-log-error", "Log start failed: "+err.Error())
			return
		}
		s.emit("ssh-log-started", map[string]any{"path": p, "format": opts.Format})
	})

	sock.On("ssh-log-stop", func(args ...any) {
		s := *sessBox
		if s == nil {
			return
		}
		s.mu.Lock()
		l := s.Log
		s.Log = nil
		s.mu.Unlock()
		if l != nil {
			l.close()
			s.emit("ssh-log-stopped")
		}
	})
}
