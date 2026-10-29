package main

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

var startTime = time.Now()

func jsonErr(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
}

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, out any) error {
	body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 60<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

func cleanName(name string) string {
	return strings.TrimSpace(strings.NewReplacer("/", "", "\\", "").Replace(name))
}

func registerFileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/system/status", func(w http.ResponseWriter, r *http.Request) {
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		host, _ := os.Hostname()
		jsonOK(w, map[string]any{
			"process":  "VY-TermWEB Professional",
			"version":  appVersion,
			"bootId":   bootID,
			"node":     runtime.Version(),
			"uptime":   time.Since(startTime).Seconds(),
			"memory":   map[string]any{"rss": ms.Sys, "heapTotal": ms.HeapSys, "heapUsed": ms.HeapAlloc},
			"platform": runtime.GOOS,
			"hostname": host,
		})
	})

	mux.HandleFunc("GET /api/local-fs", func(w http.ResponseWriter, r *http.Request) {
		dirPath := r.URL.Query().Get("path")
		if dirPath == "" {
			dirPath, _ = os.UserHomeDir()
		}
		resolved, err := filepath.Abs(dirPath)
		if err != nil {
			jsonErr(w, 400, err)
			return
		}
		entries, err := os.ReadDir(resolved)
		if err != nil {
			jsonErr(w, 400, err)
			return
		}
		type entry struct {
			Name        string `json:"name"`
			Type        string `json:"type"`
			Size        int64  `json:"size"`
			Mtime       int64  `json:"mtime"`
			Owner       string `json:"owner"`
			Permissions string `json:"permissions"`
		}
		files := []entry{}
		for _, e := range entries {
			en := entry{Name: e.Name(), Type: "file"}
			if e.IsDir() {
				en.Type = "dir"
			}
			if fi, err := os.Lstat(filepath.Join(resolved, e.Name())); err == nil {
				en.Size = fi.Size()
				en.Mtime = fi.ModTime().Unix()
				en.Owner = ownerOf(fi)
				en.Permissions = fi.Mode().String()
			}
			files = append(files, en)
		}
		sort.Slice(files, func(i, j int) bool {
			if files[i].Type == files[j].Type {
				return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
			}
			return files[i].Type == "dir"
		})
		jsonOK(w, map[string]any{"path": resolved, "files": files, "sep": string(filepath.Separator), "roots": fsRoots()})
	})

	mux.HandleFunc("GET /api/local-file", func(w http.ResponseWriter, r *http.Request) {
		filePath, _ := filepath.Abs(r.URL.Query().Get("path"))
		st, err := os.Stat(filePath)
		if err != nil {
			jsonErr(w, 404, err)
			return
		}
		if !st.Mode().IsRegular() {
			jsonErr(w, 400, fmt.Errorf("not a file"))
			return
		}
		if r.URL.Query().Get("download") == "1" {
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(filePath)))
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filePath)
	})

	mux.HandleFunc("POST /api/local-mkdir", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Dir  string `json:"dir"`
			Name string `json:"name"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, err)
			return
		}
		clean := cleanName(body.Name)
		if clean == "" {
			jsonErr(w, 400, fmt.Errorf("invalid name"))
			return
		}
		base, _ := filepath.Abs(body.Dir)
		target := filepath.Join(base, clean)
		if err := os.Mkdir(target, 0o755); err != nil {
			jsonErr(w, 400, err)
			return
		}
		jsonOK(w, map[string]any{"ok": true, "path": target})
	})

	mux.HandleFunc("POST /api/local-rename", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Dir     string `json:"dir"`
			OldName string `json:"oldName"`
			NewName string `json:"newName"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, err)
			return
		}
		clean := cleanName(body.NewName)
		if clean == "" {
			jsonErr(w, 400, fmt.Errorf("invalid name"))
			return
		}
		base, _ := filepath.Abs(body.Dir)
		if err := os.Rename(filepath.Join(base, body.OldName), filepath.Join(base, clean)); err != nil {
			jsonErr(w, 400, err)
			return
		}
		jsonOK(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("DELETE /api/local-entry", func(w http.ResponseWriter, r *http.Request) {
		target, _ := filepath.Abs(r.URL.Query().Get("path"))
		home, _ := os.UserHomeDir()
		root := string(filepath.Separator)
		if target == root || filepath.Clean(target) == filepath.Clean(home) {
			jsonErr(w, 400, fmt.Errorf("refusing to delete root/home"))
			return
		}
		if err := os.RemoveAll(target); err != nil {
			jsonErr(w, 400, err)
			return
		}
		jsonOK(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/local-write", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, err)
			return
		}
		target, _ := filepath.Abs(body.Path)
		if target == string(filepath.Separator) {
			jsonErr(w, 400, fmt.Errorf("invalid path"))
			return
		}
		if err := os.WriteFile(target, []byte(body.Content), 0o644); err != nil {
			jsonErr(w, 400, err)
			return
		}
		jsonOK(w, map[string]any{"ok": true, "path": target})
	})

	mux.HandleFunc("POST /api/local-upload", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Dir     string `json:"dir"`
			Name    string `json:"name"`
			Content string `json:"content"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, err)
			return
		}
		clean := cleanName(body.Name)
		if clean == "" {
			jsonErr(w, 400, fmt.Errorf("invalid name"))
			return
		}
		data, err := base64.StdEncoding.DecodeString(body.Content)
		if err != nil {
			jsonErr(w, 400, fmt.Errorf("invalid base64: %w", err))
			return
		}
		base, _ := filepath.Abs(body.Dir)
		target := filepath.Join(base, clean)
		if err := os.WriteFile(target, data, 0o644); err != nil {
			jsonErr(w, 400, err)
			return
		}
		jsonOK(w, map[string]any{"ok": true, "path": target})
	})

	mux.HandleFunc("POST /api/local-copy", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Sources     []string `json:"sources"`
			Destination string   `json:"destination"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, err)
			return
		}
		targetDir, _ := filepath.Abs(body.Destination)
		if st, err := os.Stat(targetDir); err != nil || !st.IsDir() {
			jsonErr(w, 400, fmt.Errorf("destination is not a directory"))
			return
		}
		if len(body.Sources) == 0 {
			jsonErr(w, 400, fmt.Errorf("no sources selected"))
			return
		}
		for _, src := range body.Sources {
			source, _ := filepath.Abs(src)
			target := copyDestination(source, targetDir)
			if strings.HasPrefix(target, source+string(filepath.Separator)) {
				jsonErr(w, 400, fmt.Errorf("cannot copy a folder into itself"))
				return
			}
			if err := copyEntry(source, target); err != nil {
				jsonErr(w, 400, err)
				return
			}
		}
		jsonOK(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("POST /api/local-move", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Sources     []string `json:"sources"`
			Destination string   `json:"destination"`
		}
		if err := readJSON(r, &body); err != nil {
			jsonErr(w, 400, err)
			return
		}
		targetDir, _ := filepath.Abs(body.Destination)
		if st, err := os.Stat(targetDir); err != nil || !st.IsDir() {
			jsonErr(w, 400, fmt.Errorf("destination is not a directory"))
			return
		}
		if len(body.Sources) == 0 {
			jsonErr(w, 400, fmt.Errorf("no sources selected"))
			return
		}
		for _, src := range body.Sources {
			source, _ := filepath.Abs(src)
			target := filepath.Join(targetDir, filepath.Base(source))
			if target == source {
				continue
			}
			if _, err := os.Stat(target); err == nil {
				jsonErr(w, 409, fmt.Errorf("%s already exists", filepath.Base(target)))
				return
			}
			if strings.HasPrefix(target, source+string(filepath.Separator)) {
				jsonErr(w, 400, fmt.Errorf("cannot move a folder into itself"))
				return
			}
			if err := os.Rename(source, target); err != nil {
				jsonErr(w, 400, err)
				return
			}
		}
		jsonOK(w, map[string]any{"ok": true})
	})

	mux.HandleFunc("GET /api/local-thumb", thumbHandler)
}

func copyDestination(source, destDir string) string {
	base := filepath.Base(source)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	target := filepath.Join(destDir, base)
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return target
	}
	for i := 1; ; i++ {
		suffix := " - Copy"
		if i > 1 {
			suffix = fmt.Sprintf(" - Copy (%d)", i)
		}
		target = filepath.Join(destDir, stem+suffix+ext)
		if _, err := os.Stat(target); os.IsNotExist(err) {
			return target
		}
	}
}

func copyEntry(src, dst string) error {
	st, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		in, err := os.Open(src)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_EXCL, st.Mode())
		if err != nil {
			return err
		}
		_, cerr := io.Copy(out, in)
		cerr2 := out.Close()
		if cerr != nil {
			return cerr
		}
		return cerr2
	}
	if err := os.Mkdir(dst, st.Mode()); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyEntry(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

// ---- Thumbnails ------------------------------------------------------------

var (
	thumbDir  = filepath.Join(os.TempDir(), "vy-termweb-thumbs")
	thumbSem  = make(chan struct{}, 4)
	thumbImg  = map[string]bool{"png": true, "jpg": true, "jpeg": true, "gif": true, "webp": true, "bmp": true, "avif": true, "tiff": true, "tif": true}
	thumbHeic = map[string]bool{"heic": true, "heif": true}
	thumbVid  = map[string]bool{"mp4": true, "webm": true, "mov": true, "mkv": true, "m4v": true, "avi": true, "mpg": true, "mpeg": true, "wmv": true, "flv": true}
)

func init() {
	os.MkdirAll(thumbDir, 0o755)
}

func thumbHandler(w http.ResponseWriter, r *http.Request) {
	filePath, _ := filepath.Abs(r.URL.Query().Get("path"))
	size := 128
	fmt.Sscanf(r.URL.Query().Get("s"), "%d", &size)
	if size < 32 {
		size = 32
	}
	if size > 1024 {
		size = 1024
	}
	st, err := os.Stat(filePath)
	if err != nil {
		jsonErr(w, 404, err)
		return
	}
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	isVid, isImg, isHeic := thumbVid[ext], thumbImg[ext], thumbHeic[ext]
	if !isVid && !isImg && !isHeic {
		jsonErr(w, 415, fmt.Errorf("unsupported type"))
		return
	}
	sum := sha1.Sum([]byte(fmt.Sprintf("%s:%v:%d:%d", filePath, st.ModTime().UnixNano(), st.Size(), size)))
	out := filepath.Join(thumbDir, hex.EncodeToString(sum[:])+".jpg")
	if _, err := os.Stat(out); err == nil {
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, out)
		return
	}

	thumbSem <- struct{}{}
	defer func() { <-thumbSem }()

	err = ffmpegThumb(filePath, out, size, isVid)
	if err != nil {
		jsonErr(w, 404, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, out)
}

func ffmpegThumb(filePath, out string, size int, isVid bool) error {
	var args []string
	if isVid {
		args = []string{"-i", filePath, "-vf", fmt.Sprintf("thumbnail,scale=%d:-2", size), "-frames:v", "1", "-y", out}
	} else {
		args = []string{"-i", filePath, "-frames:v", "1", "-vf", fmt.Sprintf("scale=%d:-2", size), "-y", out}
	}
	cmd := hostCommand("ffmpeg", args...)
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		if err != nil {
			return err
		}
		if _, err := os.Stat(out); err != nil {
			return fmt.Errorf("ffmpeg produced no output")
		}
		return nil
	case <-time.After(20 * time.Second):
		cmd.Process.Kill()
		return fmt.Errorf("ffmpeg timeout")
	}
}

// fsRoots returns the root entries for the file manager sidebar/tree —
// drive letters on Windows, common dirs on unix.
func fsRoots() []map[string]string {
	home, _ := os.UserHomeDir()
	type cand struct{ label, path string }
	var cands []cand
	if runtime.GOOS == "windows" {
		cands = append(cands, cand{"Home", home})
		for d := 'A'; d <= 'Z'; d++ {
			p := fmt.Sprintf("%c:\\", d)
			if _, err := os.Stat(p); err == nil {
				cands = append(cands, cand{strings.TrimSuffix(p, `\`), p})
			}
		}
	} else {
		cands = append(cands, cand{"Home", home}, cand{"Root", "/"},
			cand{"/tmp", "/tmp"}, cand{"/etc", "/etc"}, cand{"/var", "/var"},
			cand{"/mnt", "/mnt"}, cand{"/media", "/media"}, cand{"/projetos", "/projetos"})
	}
	roots := []map[string]string{}
	seen := map[string]bool{}
	for _, c := range cands {
		if c.path == "" || seen[c.path] {
			continue
		}
		if _, err := os.Stat(c.path); err != nil {
			continue
		}
		seen[c.path] = true
		roots = append(roots, map[string]string{"label": c.label, "path": c.path})
	}
	return roots
}
