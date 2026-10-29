//go:build windows

package main

import (
	"context"
	"os"

	"github.com/UserExistsError/conpty"
)

type winPty struct {
	cpty *conpty.ConPty
}

func startLocalShell(cols, rows int, cwd string, onData func(string), onExit func(int)) (localPty, error) {
	shell := os.Getenv("COMSPEC")
	if shell == "" {
		shell = "cmd.exe"
	}
	cpty, err := conpty.Start(shell,
		conpty.ConPtyDimensions(cols, rows),
		conpty.ConPtyWorkDir(cwd),
		conpty.ConPtyEnv(append(os.Environ(), "TERM=xterm-256color")),
	)
	if err != nil {
		return nil, err
	}
	p := &winPty{cpty: cpty}

	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := cpty.Read(buf)
			if n > 0 {
				onData(string(buf[:n]))
			}
			if err != nil {
				break
			}
		}
	}()
	go func() {
		code, err := cpty.Wait(context.Background())
		if err != nil {
			code = 1
		}
		onExit(int(code))
	}()
	return p, nil
}

func (p *winPty) Write(b []byte) (int, error) { return p.cpty.Write(b) }

func (p *winPty) Resize(cols, rows int) error { return p.cpty.Resize(cols, rows) }

func (p *winPty) Close() error { return p.cpty.Close() }
