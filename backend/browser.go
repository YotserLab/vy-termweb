package main

import (
	"log"
	"os/exec"
	"runtime"
	"time"
)

// openBrowser opens the app URL in the default browser after a short delay
// so the listener is up first.
func openBrowser(url string) {
	time.Sleep(500 * time.Millisecond)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = hostCommand("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("could not open browser: %v — visit %s manually", err, url)
		return
	}
	log.Printf("opened %s in the default browser", url)
}
