package main

// Panel authentication: an optional master password gates every /api/* route
// and the socket.io transports. The password is either provided via the
// VY_MASTER_PASSWORD environment variable (service/headless setups) or created
// on first run through POST /api/auth/setup, which stores a PBKDF2-SHA256 hash
// in ~/.vy-termweb/auth.json (0600). Successful logins receive a stateless
// HMAC-signed bearer token (24h); the SPA also sends it as ?token= on file
// URLs and the socket.io handshake query, where headers cannot be attached.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/pbkdf2"
)

const (
	authTokenTTL   = 24 * time.Hour
	authPBKDF2Iter = 210_000
	authMinPassLen = 4
)

type panelAuth struct {
	mu       sync.RWMutex
	key      []byte // PBKDF2-derived key, or sha256(password) when set via env
	salt     []byte
	iter     int
	fromEnv  bool
	required bool
	disabled bool
}

var auth panelAuth

func authConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".vy-termweb", "auth.json")
}

type authFile struct {
	KDF  string `json:"kdf"`
	Iter int    `json:"iter"`
	Salt string `json:"salt"`
	Hash string `json:"hash"`
}

// loadPanelAuth resolves the credential source once at boot.
func loadPanelAuth() {
	if pw := os.Getenv("VY_MASTER_PASSWORD"); pw != "" {
		sum := sha256.Sum256([]byte(pw))
		auth.mu.Lock()
		auth.key, auth.fromEnv, auth.required = sum[:], true, true
		auth.mu.Unlock()
		log.Printf("panel auth enabled via VY_MASTER_PASSWORD")
		return
	}
	// Development mode: DIST_DIR only serves a frontend from disk (dev.sh sets
	// it) — never present on packaged/production runs. VY_AUTH_DISABLED is the
	// explicit opt-out for other setups (e.g. behind an auth proxy).
	if envTruthy(os.Getenv("VY_AUTH_DISABLED")) || os.Getenv("DIST_DIR") != "" {
		auth.mu.Lock()
		auth.disabled = true
		auth.mu.Unlock()
		log.Printf("panel auth disabled (development mode)")
		return
	}
	path := authConfigPath()
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return // no auth.json yet -> first-run setup mode
	}
	var af authFile
	if json.Unmarshal(raw, &af) != nil {
		return
	}
	salt, err1 := base64.StdEncoding.DecodeString(af.Salt)
	hash, err2 := base64.StdEncoding.DecodeString(af.Hash)
	if err1 != nil || err2 != nil || len(hash) == 0 {
		return
	}
	auth.mu.Lock()
	auth.key, auth.salt, auth.iter, auth.required = hash, salt, af.Iter, true
	auth.mu.Unlock()
	log.Printf("panel auth enabled via %s", path)
}

// verifyPassword compares a candidate against the stored credential in
// constant time.
func verifyPassword(pw string) bool {
	auth.mu.RLock()
	defer auth.mu.RUnlock()
	if !auth.required || len(auth.key) == 0 {
		return false
	}
	var candidate []byte
	if auth.fromEnv {
		sum := sha256.Sum256([]byte(pw))
		candidate = sum[:]
	} else {
		candidate = pbkdf2.Key([]byte(pw), auth.salt, auth.iter, len(auth.key), sha256.New)
	}
	return subtle.ConstantTimeCompare(candidate, auth.key) == 1
}

// tokenSecret derives the HMAC key from the credential — changing the password
// invalidates every outstanding token.
func tokenSecret() []byte {
	auth.mu.RLock()
	defer auth.mu.RUnlock()
	sum := sha256.Sum256(append([]byte("vy-termweb-token\x00"), auth.key...))
	return sum[:]
}

// issueToken returns "base64url(expiryUnix).base64url(hmac)".
func issueToken() string {
	exp := strconv.FormatInt(time.Now().Add(authTokenTTL).Unix(), 10)
	mac := hmac.New(sha256.New, tokenSecret())
	mac.Write([]byte(exp))
	return base64.RawURLEncoding.EncodeToString([]byte(exp)) + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func validToken(tok string) bool {
	dot := strings.LastIndexByte(tok, '.')
	if dot < 0 {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(tok[:dot])
	if err != nil {
		return false
	}
	exp, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || time.Now().Unix() >= exp {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(tok[dot+1:])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, tokenSecret())
	mac.Write(raw)
	return hmac.Equal(sig, mac.Sum(nil))
}

// requestToken pulls the bearer token from the Authorization header or the
// ?token= query parameter (media tags and downloads cannot send headers).
func requestToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return h[7:]
	}
	return r.URL.Query().Get("token")
}

// isPublicPath: static assets and the SPA shell stay reachable so the lock
// screen can render; every API route and the socket.io transports are gated.
func isPublicPath(r *http.Request) bool {
	p := r.URL.Path
	if p == "/api/auth/status" || p == "/api/auth/login" || p == "/api/auth/setup" {
		return true
	}
	if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/socket.io/") {
		return false
	}
	return r.Method == http.MethodGet || r.Method == http.MethodHead
}

func envTruthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func authDisabled() bool {
	auth.mu.RLock()
	defer auth.mu.RUnlock()
	return auth.disabled
}

// authGate requires a valid token on every non-public route — including while
// first-run setup is pending, so an unconfigured server is not left open on
// the network (whoever completes /api/auth/setup receives the first token).
func authGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authDisabled() || isPublicPath(r) || validToken(requestToken(r)) {
			next.ServeHTTP(w, r)
			return
		}
		jsonErr(w, http.StatusUnauthorized, errString("authentication required"))
	})
}

type errString string

func (e errString) Error() string { return string(e) }

// --- login rate limiting ----------------------------------------------------

const (
	authFailWindow = 5 * time.Minute
	authFailMax    = 10
)

var authFails struct {
	mu sync.Mutex
	m  map[string][]time.Time
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func authThrottled(r *http.Request) bool {
	ip := clientIP(r)
	now := time.Now()
	authFails.mu.Lock()
	defer authFails.mu.Unlock()
	if authFails.m == nil {
		authFails.m = map[string][]time.Time{}
	}
	keep := authFails.m[ip][:0]
	for _, t := range authFails.m[ip] {
		if now.Sub(t) < authFailWindow {
			keep = append(keep, t)
		}
	}
	authFails.m[ip] = keep
	return len(keep) >= authFailMax
}

func authRecordFail(r *http.Request) {
	ip := clientIP(r)
	authFails.mu.Lock()
	if authFails.m == nil {
		authFails.m = map[string][]time.Time{}
	}
	authFails.m[ip] = append(authFails.m[ip], time.Now())
	authFails.mu.Unlock()
	time.Sleep(400 * time.Millisecond)
}

// --- routes -----------------------------------------------------------------

func registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		auth.mu.RLock()
		required, hasKey, disabled := auth.required, len(auth.key) > 0, auth.disabled
		auth.mu.RUnlock()
		jsonOK(w, map[string]any{
			"required":      required,
			"needsSetup":    !disabled && !hasKey && os.Getenv("VY_MASTER_PASSWORD") == "",
			"authenticated": disabled || validToken(requestToken(r)),
			"disabled":      disabled,
		})
	})

	mux.HandleFunc("POST /api/auth/setup", func(w http.ResponseWriter, r *http.Request) {
		auth.mu.RLock()
		hasKey, fromEnv := len(auth.key) > 0, auth.fromEnv
		auth.mu.RUnlock()
		if hasKey || fromEnv {
			jsonErr(w, http.StatusConflict, errString("password already configured"))
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, errString("invalid payload"))
			return
		}
		if len(body.Password) < authMinPassLen {
			jsonErr(w, 400, errString("password too short (min 4 chars)"))
			return
		}
		if err := saveAuthConfig(body.Password); err != nil {
			jsonErr(w, 500, err)
			return
		}
		jsonOK(w, map[string]any{"token": issueToken(), "expiresIn": int(authTokenTTL.Seconds())})
	})

	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		auth.mu.RLock()
		required := auth.required
		auth.mu.RUnlock()
		if !required {
			jsonErr(w, http.StatusConflict, errString("setup required first"))
			return
		}
		if authThrottled(r) {
			jsonErr(w, http.StatusTooManyRequests, errString("too many attempts, try later"))
			return
		}
		var body struct {
			Password string `json:"password"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, errString("invalid payload"))
			return
		}
		if !verifyPassword(body.Password) {
			authRecordFail(r)
			jsonErr(w, http.StatusUnauthorized, errString("incorrect password"))
			return
		}
		jsonOK(w, map[string]any{"token": issueToken(), "expiresIn": int(authTokenTTL.Seconds())})
	})

	mux.HandleFunc("POST /api/auth/change", func(w http.ResponseWriter, r *http.Request) {
		auth.mu.RLock()
		fromEnv := auth.fromEnv
		auth.mu.RUnlock()
		if fromEnv {
			jsonErr(w, 400, errString("password is configured via VY_MASTER_PASSWORD"))
			return
		}
		var body struct {
			Current string `json:"current"`
			New     string `json:"new"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, errString("invalid payload"))
			return
		}
		if !verifyPassword(body.Current) {
			authRecordFail(r)
			jsonErr(w, http.StatusUnauthorized, errString("incorrect password"))
			return
		}
		if len(body.New) < authMinPassLen {
			jsonErr(w, 400, errString("password too short (min 4 chars)"))
			return
		}
		if err := saveAuthConfig(body.New); err != nil {
			jsonErr(w, 500, err)
			return
		}
		jsonOK(w, map[string]any{"token": issueToken(), "expiresIn": int(authTokenTTL.Seconds())})
	})
}

// saveAuthConfig writes the PBKDF2 hash file and swaps the in-memory key.
func saveAuthConfig(pw string) error {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	key := pbkdf2.Key([]byte(pw), salt, authPBKDF2Iter, 32, sha256.New)
	path := authConfigPath()
	if path == "" {
		return errString("cannot resolve home directory")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	af := authFile{
		KDF:  "pbkdf2-sha256",
		Iter: authPBKDF2Iter,
		Salt: base64.StdEncoding.EncodeToString(salt),
		Hash: base64.StdEncoding.EncodeToString(key),
	}
	raw, err := json.Marshal(af)
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return err
	}
	auth.mu.Lock()
	auth.key, auth.salt, auth.iter, auth.fromEnv, auth.required = key, salt, authPBKDF2Iter, false, true
	auth.mu.Unlock()
	return nil
}
