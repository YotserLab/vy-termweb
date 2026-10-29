package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"sync"
	"time"

	"github.com/pkg/sftp"
	siosocket "github.com/zishang520/socket.io/v2/socket"
	"golang.org/x/crypto/ssh"
)

type sftpLike interface {
	RealPath(p string) (string, error)
	ReadDir(p string) ([]os.FileInfo, error)
	Open(p string) (*sftp.File, error)
	Create(p string) (*sftp.File, error)
	Remove(p string) error
	RemoveDirectory(p string) error
	Mkdir(p string) error
	Rename(oldPath, newPath string) error
	Close() error
}

type sshHopConfig struct {
	Host           string `json:"host"`
	Port           int    `json:"port"`
	User           string `json:"user"`
	Password       string `json:"password"`
	PrivateKey     string `json:"privateKey"`
	PrivateKeyPath string `json:"privateKeyPath"`
	Passphrase     string `json:"passphrase"`
}

type sshConnectConfig struct {
	Host           string         `json:"host"`
	Port           int            `json:"port"`
	User           string         `json:"user"`
	Password       string         `json:"password"`
	PrivateKey     string         `json:"privateKey"`
	PrivateKeyPath string         `json:"privateKeyPath"`
	Passphrase     string         `json:"passphrase"`
	Tunnels        []tunnelSpec   `json:"tunnels"`
	Hops           []sshHopConfig `json:"hops"`
	Logging        string         `json:"logging"`
	Cols           int            `json:"cols"`
	Rows           int            `json:"rows"`
	ResumeID       string         `json:"resumeId"`
	Seen           *int           `json:"seen"`
}

func decodePayload(arg any, out any) {
	raw, err := json.Marshal(arg)
	if err != nil {
		return
	}
	json.Unmarshal(raw, out)
}

func firstArg(args []any) any {
	if len(args) == 0 {
		return nil
	}
	return args[0]
}

func initSFTP(s *TermSession) {
	s.mu.Lock()
	conn := s.Conn
	s.mu.Unlock()
	if conn == nil {
		return
	}
	cli, err := sftp.NewClient(conn)
	s.mu.Lock()
	s.SFTPPending = false
	if err == nil {
		s.SFTP = cli
		s.SFTPFailed = false
	}
	s.mu.Unlock()
	if err == nil {
		s.emit("sftp-ready")
	} else {
		s.emit("sftp-error", "SFTP init failed: "+err.Error())
	}
}

func startLocalTunnel(s *TermSession, t tunnelSpec) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", t.LocalPort))
	if err != nil {
		s.emit("tunnel-error", fmt.Sprintf("Tunnel :%d -> %s:%d failed: %s", t.LocalPort, t.RemoteHost, t.RemotePort, err.Error()))
		return
	}
	s.mu.Lock()
	s.Tunnels = append(s.Tunnels, ln)
	s.mu.Unlock()
	s.emit("tunnel-ready", map[string]any{"localPort": t.LocalPort, "remoteHost": t.RemoteHost, "remotePort": t.RemotePort})

	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(clientSock net.Conn) {
				defer clientSock.Close()
				s.mu.Lock()
				conn := s.Conn
				s.mu.Unlock()
				if conn == nil {
					return
				}
				stream, err := conn.Dial("tcp", fmt.Sprintf("%s:%d", t.RemoteHost, t.RemotePort))
				if err != nil {
					return
				}
				defer stream.Close()
				var wg sync.WaitGroup
				wg.Add(2)
				go func() { defer wg.Done(); io.Copy(stream, clientSock) }()
				go func() { defer wg.Done(); io.Copy(clientSock, stream) }()
				wg.Wait()
			}(c)
		}
	}()
}

func startRemoteTunnel(s *TermSession, t tunnelSpec) {
	addr := t.RemoteHost
	if addr == "localhost" {
		addr = "127.0.0.1"
	}
	s.mu.Lock()
	conn := s.Conn
	s.mu.Unlock()
	if conn == nil {
		return
	}
	ln, err := conn.Listen("tcp", fmt.Sprintf("%s:%d", addr, t.RemotePort))
	if err != nil {
		s.emit("tunnel-error", fmt.Sprintf("Remote tunnel %s:%d -> :%d failed: %s", t.RemoteHost, t.RemotePort, t.LocalPort, err.Error()))
		return
	}
	s.mu.Lock()
	s.Remote = append(s.Remote, ln)
	s.mu.Unlock()
	s.emit("tunnel-ready", map[string]any{"type": "remote", "localPort": t.LocalPort, "remoteHost": t.RemoteHost, "remotePort": t.RemotePort})

	go func() {
		for {
			stream, err := ln.Accept()
			if err != nil {
				return
			}
			go func(remoteConn net.Conn) {
				defer remoteConn.Close()
				out, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", t.LocalPort), 10*time.Second)
				if err != nil {
					return
				}
				defer out.Close()
				var wg sync.WaitGroup
				wg.Add(2)
				go func() { defer wg.Done(); io.Copy(out, remoteConn) }()
				go func() { defer wg.Done(); io.Copy(remoteConn, out) }()
				wg.Wait()
			}(stream)
		}
	}()
}

func buildAuthMethods(h sshHopConfig) ([]ssh.AuthMethod, error) {
	var auths []ssh.AuthMethod
	if h.Password != "" {
		auths = append(auths,
			ssh.Password(h.Password),
			ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range answers {
					answers[i] = h.Password
				}
				return answers, nil
			}),
		)
	}
	key := h.PrivateKey
	if key == "" && h.PrivateKeyPath != "" {
		raw, err := os.ReadFile(h.PrivateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("cannot read private key file: %w", err)
		}
		key = string(raw)
	}
	if key != "" {
		var signer ssh.Signer
		var err error
		if h.Passphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(key), []byte(h.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(key))
		}
		if err != nil {
			return nil, fmt.Errorf("invalid private key: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	return auths, nil
}

func dialTarget(h sshHopConfig, prev *ssh.Client) (*ssh.Client, error) {
	auths, err := buildAuthMethods(h)
	if err != nil {
		return nil, err
	}
	if len(auths) == 0 {
		return nil, fmt.Errorf("no credentials provided — set a password or a private key in the session settings")
	}
	port := h.Port
	if port == 0 {
		port = 22
	}
	user := h.User
	if user == "" {
		user = "root"
	}
	clientCfg := &ssh.ClientConfig{
		User:            user,
		Auth:            auths,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         20 * time.Second,
	}
	addr := fmt.Sprintf("%s:%d", h.Host, port)
	if prev == nil {
		return ssh.Dial("tcp", addr, clientCfg)
	}
	// Jump host: open a direct-tcpip channel through the previous hop.
	nc, err := prev.Dial("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("via jump host %s: %w", prev.Conn.RemoteAddr(), err)
	}
	c, chans, reqs, err := ssh.NewClientConn(nc, addr, clientCfg)
	if err != nil {
		return nil, fmt.Errorf("via jump host %s: %w", prev.Conn.RemoteAddr(), err)
	}
	return ssh.NewClient(c, chans, reqs), nil
}

// startDynamicTunnel implements `ssh -D`: a local SOCKS5 listener that proxies
// connections through the SSH connection (remote host/port fields unused).
func startDynamicTunnel(s *TermSession, t tunnelSpec) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", t.LocalPort))
	if err != nil {
		s.emit("tunnel-error", fmt.Sprintf("SOCKS5 proxy :%d failed: %s", t.LocalPort, err.Error()))
		return
	}
	s.mu.Lock()
	s.Tunnels = append(s.Tunnels, ln)
	s.mu.Unlock()
	s.emit("tunnel-ready", map[string]any{"type": "dynamic", "localPort": t.LocalPort, "remoteHost": "SOCKS5", "remotePort": 0})

	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go handleSOCKS5(s, c)
		}
	}()
}

// Minimal SOCKS5 server: no-auth greeting + CONNECT (IPv4/domain/IPv6).
func handleSOCKS5(s *TermSession, c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(15 * time.Second))
	buf := make([]byte, 262)

	// greeting: VER=5, NMETHODS, METHODS...
	n, err := io.ReadFull(c, buf[:2])
	if err != nil || n != 2 || buf[0] != 0x05 {
		return
	}
	nmethods := int(buf[1])
	if _, err := io.ReadFull(c, buf[:nmethods]); err != nil {
		return
	}
	if _, err := c.Write([]byte{0x05, 0x00}); err != nil { // VER, NOAUTH
		return
	}

	// request: VER=5, CMD=CONNECT, RSV, ATYP, ADDR, PORT
	if _, err := io.ReadFull(c, buf[:4]); err != nil {
		return
	}
	if buf[0] != 0x05 || buf[1] != 0x01 {
		socksReply(c, 0x07)
		return
	}
	var host string
	switch buf[3] {
	case 0x01: // IPv4
		if _, err := io.ReadFull(c, buf[:4]); err != nil {
			return
		}
		host = net.IP(buf[:4]).String()
	case 0x03: // domain
		if _, err := io.ReadFull(c, buf[:1]); err != nil {
			return
		}
		dlen := int(buf[0])
		if _, err := io.ReadFull(c, buf[:dlen]); err != nil {
			return
		}
		host = string(buf[:dlen])
	case 0x04: // IPv6
		if _, err := io.ReadFull(c, buf[:16]); err != nil {
			return
		}
		host = net.IP(buf[:16]).String()
	default:
		socksReply(c, 0x08)
		return
	}
	if _, err := io.ReadFull(c, buf[:2]); err != nil {
		return
	}
	port := int(buf[0])<<8 | int(buf[1])

	s.mu.Lock()
	conn := s.Conn
	s.mu.Unlock()
	if conn == nil {
		socksReply(c, 0x05)
		return
	}
	stream, err := conn.Dial("tcp", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		socksReply(c, 0x05)
		return
	}
	defer stream.Close()
	if err := socksReply(c, 0x00); err != nil {
		return
	}
	c.SetDeadline(time.Time{})

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); io.Copy(stream, c) }()
	go func() { defer wg.Done(); io.Copy(c, stream) }()
	wg.Wait()
}

func socksReply(c net.Conn, rep byte) error {
	// VER=5, REP, RSV=0, ATYP=IPv4, BND.ADDR=0.0.0.0, BND.PORT=0
	_, err := c.Write([]byte{0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
	return err
}

func connectSSH(s *TermSession, cfg sshConnectConfig, sock *siosocket.Socket) {
	s.mu.Lock()
	s.Cols, s.Rows = cfg.Cols, cfg.Rows
	s.mu.Unlock()

	// Chain: hop1 -> hop2 -> ... -> final target.
	chain := append([]sshHopConfig{}, cfg.Hops...)
	chain = append(chain, sshHopConfig{
		Host:           cfg.Host,
		Port:           cfg.Port,
		User:           cfg.User,
		Password:       cfg.Password,
		PrivateKey:     cfg.PrivateKey,
		PrivateKeyPath: cfg.PrivateKeyPath,
		Passphrase:     cfg.Passphrase,
	})

	var conn *ssh.Client
	var hops []*ssh.Client
	for i, hop := range chain {
		c, err := dialTarget(hop, conn)
		if err != nil {
			for _, h := range hops {
				h.Close()
			}
			sock.Emit("ssh-error", fmt.Sprintf("SSH Error (hop %d/%d): %s", i+1, len(chain), err.Error()))
			s.mu.Lock()
			s.Dead = true
			s.mu.Unlock()
			return
		}
		hops = append(hops, c)
		conn = c
	}
	if len(hops) > 1 {
		s.mu.Lock()
		s.Hops = hops[:len(hops)-1]
		s.mu.Unlock()
		sock.Emit("ssh-info", map[string]any{"banner": fmt.Sprintf("connected via %d jump host(s)", len(hops)-1)})
	}
	s.mu.Lock()
	s.Conn = conn
	s.mu.Unlock()

	sock.Emit("ssh-info", map[string]any{
		"banner": string(conn.ServerVersion()),
		"cipher": "",
		"kex":    "",
		"mac":    "",
	})
	sock.Emit("ssh-ready", "Connection established.\r\n")

	// keepalive — on failure mark the session dead (all hops get keepalives so
	// an idle jump connection doesn't drop mid-session)
	go func() {
		tick := time.NewTicker(30 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-s.done:
				return
			case <-tick.C:
				s.mu.Lock()
				clients := append(append([]*ssh.Client{}, s.Hops...), s.Conn)
				s.mu.Unlock()
				failed := false
				for _, c := range clients {
					if c == nil {
						continue
					}
					if _, _, err := c.SendRequest("keepalive@openssh.com", true, nil); err != nil {
						failed = true
					}
				}
				if failed {
					s.mu.Lock()
					s.Dead = true
					s.mu.Unlock()
					s.emit("ssh-close")
					return
				}
			}
		}
	}()

	if cfg.Logging != "" && cfg.Logging != "off" {
		if p, err := startSessionLog(s, cfg.Logging); err == nil {
			s.emit("ssh-log-started", map[string]any{"path": p, "format": cfg.Logging})
		} else {
			s.emit("ssh-log-error", "Log start failed: "+err.Error())
		}
	}

	s.mu.Lock()
	s.SFTPPending = true
	s.mu.Unlock()
	go func() {
		initSFTP(s)
		s.mu.Lock()
		if s.SFTP == nil {
			s.SFTPFailed = true
		}
		s.mu.Unlock()
	}()

	for _, t := range cfg.Tunnels {
		if t.Type == "local" {
			startLocalTunnel(s, t)
		} else if t.Type == "remote" {
			startRemoteTunnel(s, t)
		} else if t.Type == "dynamic" {
			startDynamicTunnel(s, t)
		}
	}

	s.mu.Lock()
	cols, rows := s.Cols, s.Rows
	s.mu.Unlock()
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	sess, err := conn.NewSession()
	if err != nil {
		sock.Emit("ssh-error", "Shell error: "+err.Error())
		return
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		sock.Emit("ssh-error", "Shell error: "+err.Error())
		return
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sock.Emit("ssh-error", "Shell error: "+err.Error())
		return
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sock.Emit("ssh-error", "Shell error: "+err.Error())
		return
	}
	sess.Stderr = sess.Stdout
	if err := sess.Shell(); err != nil {
		sock.Emit("ssh-error", "Shell error: "+err.Error())
		return
	}
	s.mu.Lock()
	s.SSHSession = sess
	s.SSHStdin = stdin
	// A resize may have arrived while the shell was being set up and been
	// stored but not applied — sync the remote window size now.
	latestCols, latestRows := s.Cols, s.Rows
	s.mu.Unlock()
	if latestCols > 0 && latestRows > 0 && (latestCols != cols || latestRows != rows) {
		sess.WindowChange(latestRows, latestCols)
	}

	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				s.pushData(string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
		s.mu.Lock()
		s.Dead = true
		s.mu.Unlock()
		s.emit("ssh-close")
	}()
}

func registerSSHHandlers(sock *siosocket.Socket, sessBox **TermSession) {
	sock.On("local-shell", func(args ...any) {
		if *sessBox != nil {
			return
		}
		var opts struct {
			Cols     int    `json:"cols"`
			Rows     int    `json:"rows"`
			Cwd      string `json:"cwd"`
			Logging  string `json:"logging"`
			ResumeID string `json:"resumeId"`
			Seen     *int   `json:"seen"`
		}
		decodePayload(firstArg(args), &opts)
		if resumed := tryResume(opts.ResumeID, seenOr(opts.Seen), sock); resumed != nil {
			*sessBox = resumed
			return
		}
		s := newTermSession(opts.ResumeID, sock)
		s.mu.Lock()
		s.Cols, s.Rows = opts.Cols, opts.Rows
		s.mu.Unlock()
		*sessBox = s
		cwd := opts.Cwd
		if cwd == "" {
			cwd, _ = os.UserHomeDir()
		}
		cols, rows := opts.Cols, opts.Rows
		if cols == 0 {
			cols = 80
		}
		if rows == 0 {
			rows = 24
		}
		p, err := startLocalShell(cols, rows, cwd,
			func(d string) { s.pushData(d) },
			func(code int) {
				s.emit("ssh-close", map[string]any{"code": code})
				s.mu.Lock()
				s.Pty = nil
				s.Dead = true
				s.mu.Unlock()
			})
		if err != nil {
			sock.Emit("ssh-error", "PTY error: "+err.Error())
			return
		}
		s.mu.Lock()
		s.Pty = p
		lc, lr := s.Cols, s.Rows
		s.mu.Unlock()
		if lc > 0 && lr > 0 && (lc != cols || lr != rows) {
			p.Resize(lc, lr)
		}
		if opts.Logging != "" && opts.Logging != "off" {
			if p, err := startSessionLog(s, opts.Logging); err == nil {
				s.emit("ssh-log-started", map[string]any{"path": p, "format": opts.Logging})
			} else {
				s.emit("ssh-log-error", "Log start failed: "+err.Error())
			}
		}
		sock.Emit("shell-ready")
	})

	sock.On("ssh-connect", func(args ...any) {
		if *sessBox != nil {
			return
		}
		var cfg sshConnectConfig
		decodePayload(firstArg(args), &cfg)
		if resumed := tryResume(cfg.ResumeID, seenOr(cfg.Seen), sock); resumed != nil {
			*sessBox = resumed
			return
		}
		s := newTermSession(cfg.ResumeID, sock)
		*sessBox = s
		go connectSSH(s, cfg, sock)
	})

	sock.On("ssh-input", func(args ...any) {
		s := *sessBox
		if s == nil {
			return
		}
		data, _ := firstArg(args).(string)
		if data == "" {
			return
		}
		s.mu.Lock()
		stdin, p := s.SSHStdin, s.Pty
		s.mu.Unlock()
		if stdin != nil {
			stdin.Write([]byte(data))
		} else if p != nil {
			p.Write([]byte(data))
		}
	})

	sock.On("ssh-resize", func(args ...any) {
		s := *sessBox
		if s == nil {
			return
		}
		var dims struct {
			Cols int `json:"cols"`
			Rows int `json:"rows"`
		}
		decodePayload(firstArg(args), &dims)
		if dims.Cols <= 0 || dims.Rows <= 0 {
			return
		}
		s.mu.Lock()
		s.Cols, s.Rows = dims.Cols, dims.Rows
		sess, p := s.SSHSession, s.Pty
		s.mu.Unlock()
		if sess != nil {
			sess.WindowChange(dims.Rows, dims.Cols)
		}
		if p != nil {
			p.Resize(dims.Cols, dims.Rows)
		}
	})
}

func seenOr(seen *int) int {
	if seen == nil {
		return -1
	}
	return *seen
}

func sftpJoin(dir, name string) string { return path.Join(dir, name) }

func decodeUploadContent(arg any) []byte {
	switch v := arg.(type) {
	case []byte:
		return v
	case string:
		// Client may send base64 text for binary content.
		if b, err := base64.StdEncoding.DecodeString(v); err == nil {
			return b
		}
		return []byte(v)
	}
	return nil
}
