//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixPty struct {
	ptmx *os.File
	cmd  *exec.Cmd
}

func startLocalShell(cols, rows int, cwd string, onData func(string), onExit func(int)) (localPty, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}
	var cmd *exec.Cmd
	if inFlatpak() {
		// Spawn the shell on the host so Local Shell is a real session, not a
		// sandboxed runtime shell. flatpak-spawn forwards the pty stdio.
		args := []string{"--host"}
		if cwd != "" {
			args = append(args, "--directory="+cwd)
		}
		cmd = exec.Command("flatpak-spawn", append(args, shell, "-l")...)
	} else {
		cmd = exec.Command(shell, "-l")
	}
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return nil, err
	}
	p := &unixPty{ptmx: ptmx, cmd: cmd}

	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				onData(string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		code := 0
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			code = ee.ExitCode()
		}
		onExit(code)
	}()
	return p, nil
}

func (p *unixPty) Write(b []byte) (int, error) { return p.ptmx.Write(b) }

func (p *unixPty) Resize(cols, rows int) error {
	return pty.Setsize(p.ptmx, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

func (p *unixPty) Close() error {
	if p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
	return p.ptmx.Close()
}
