package main

import (
	"bufio"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	siosocket "github.com/zishang520/socket.io/v2/socket"
)

//go:embed all:dist
var distFS embed.FS

const appVersion = "1.3.0"

// bootID identifies this server instance — changes on every restart so
// clients can invalidate cached state (thumbs, pending opens, etc.).
var bootID = fmt.Sprintf("%x-%x", time.Now().Unix(), time.Now().UnixNano())

func main() {
	var portFlag int
	flag.IntVar(&portFlag, "port", 0, "HTTP port to listen on (default: PORT env or 32230)")
	flag.IntVar(&portFlag, "p", 0, "shorthand for -port")
	flag.Parse()

	port := os.Getenv("PORT")
	if portFlag != 0 {
		port = strconv.Itoa(portFlag)
	}
	if port == "" {
		port = "32230"
	}

	opts := siosocket.DefaultServerOptions()
	opts.SetPingInterval(10 * time.Second)
	opts.SetPingTimeout(30 * time.Second)
	opts.SetMaxHttpBufferSize(50 * 1024 * 1024)
	io := siosocket.NewServer(nil, opts)

	io.On("connection", func(clients ...any) {
		sock := clients[0].(*siosocket.Socket)
		log.Printf("[socket] connected id=%s", sock.Id())
		sock.Emit("server-boot", bootID)
		var sess *TermSession
		registerSSHHandlers(sock, &sess)
		registerSFTPHandlers(sock, &sess)
		registerNetscanHandlers(sock)
		registerLogHandlers(sock, &sess)
		sock.On("disconnect", func(args ...any) {
			log.Printf("[socket] disconnected id=%s", sock.Id())
			if sess != nil {
				parkOrDestroy(sess, sock)
				sess = nil
			}
		})
	})

	mux := http.NewServeMux()
	registerAuthRoutes(mux)
	registerFileRoutes(mux)
	registerSysinfoRoutes(mux)
	mux.Handle("/socket.io/", io.ServeHandler(nil))
	mux.Handle("/", spaHandler())

	loadPanelAuth()

	url := "http://localhost:" + port
	log.Printf("VY-TermWEB Server (go) running on %s", url)
	if os.Getenv("NO_OPEN") != "1" {
		go openBrowser(url)
	}
	log.Fatal(http.ListenAndServe("0.0.0.0:"+port, accessLog(authGate(mux))))
}

// accessLog logs every HTTP request: method, path, status, bytes, duration, remote.
func accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		// Redact the auth token before logging the URL.
		u := *r.URL
		if q := u.Query(); q.Has("token") {
			q.Del("token")
			u.RawQuery = q.Encode()
		}
		log.Printf("%s %s -> %d %dB %s %s", r.Method, u.RequestURI(), rw.status, rw.n, time.Since(start).Round(time.Microsecond), r.RemoteAddr)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	n      int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.n += n
	return n, err
}

// Hijack and Flush pass through so WebSocket upgrades (socket.io) keep working.
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying writer does not support hijack")
	}
	return hj.Hijack()
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// spaHandler serves the Vite build with SPA fallback to index.html.
// If DIST_DIR is set the frontend is served from disk (dev mode, picks up
// rebuilds); otherwise the embedded go:embed copy is used.
func spaHandler() http.Handler {
	var sub fs.FS
	if dir := os.Getenv("DIST_DIR"); dir != "" {
		sub = os.DirFS(dir)
		log.Printf("serving frontend from disk: %s", dir)
	} else {
		var err error
		sub, err = fs.Sub(distFS, "dist")
		if err != nil {
			log.Fatalf("embedded dist missing: %v", err)
		}
	}
	fileServer := http.FileServer(http.FS(sub))
	var mu sync.Mutex
	var lastIndex []byte
	serveIndex := func(w http.ResponseWriter) {
		index, err := fs.ReadFile(sub, "index.html")
		mu.Lock()
		if err == nil {
			lastIndex = index
		} else {
			index = lastIndex // transient miss during vite rebuild — serve last good copy
		}
		mu.Unlock()
		if index == nil {
			http.Error(w, "index.html missing — run `pnpm build` first", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(index)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if info, err := fs.Stat(sub, p); err == nil && !info.IsDir() {
			// Vite assets carry a content hash in the filename — safe to cache
			// forever. Everything else revalidates so a new server build is
			// picked up on reload.
			if strings.HasPrefix(p, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		serveIndex(w)
	})
}
