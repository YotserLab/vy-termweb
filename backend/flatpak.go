package main

import (
	"os"
	"os/exec"
)

// inFlatpak reports whether the server is running inside a Flatpak sandbox.
// Flatpak sets FLATPAK_ID for every sandboxed process.
func inFlatpak() bool {
	return os.Getenv("FLATPAK_ID") != ""
}

// hostCommand builds a command that operates on the real system. Inside a
// Flatpak sandbox it goes through flatpak-spawn --host (requires the
// org.freedesktop.Flatpak talk-name) so local shells, network tools and
// ffmpeg act on the host instead of the sandboxed runtime. Outside Flatpak
// it is a plain exec.Command.
func hostCommand(name string, args ...string) *exec.Cmd {
	if inFlatpak() {
		return exec.Command("flatpak-spawn", append([]string{"--host", name}, args...)...)
	}
	return exec.Command(name, args...)
}
