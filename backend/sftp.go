package main

import (
	"io"
	"path"

	siosocket "github.com/zishang520/socket.io/v2/socket"
)

func getSFTP(s *TermSession) sftpLike {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.SFTP
}

func registerSFTPHandlers(sock *siosocket.Socket, sessBox **TermSession) {
	sock.On("sftp-ls", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		dirPath, _ := firstArg(args).(string)
		if dirPath == "" {
			dirPath = "."
		}
		resolved, err := sftp.RealPath(dirPath)
		target := dirPath
		if err == nil {
			target = resolved
		}
		list, err := sftp.ReadDir(target)
		if err != nil {
			sock.Emit("sftp-error", "LS error: "+err.Error())
			return
		}
		files := make([]map[string]any, 0, len(list))
		for _, f := range list {
			typ := "file"
			if f.IsDir() {
				typ = "dir"
			}
			files = append(files, map[string]any{
				"name":  f.Name(),
				"type":  typ,
				"size":  f.Size(),
				"mtime": f.ModTime().Unix(),
			})
		}
		sock.Emit("sftp-list", map[string]any{"path": target, "files": files})
	})

	sock.On("sftp-download", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		remotePath, _ := firstArg(args).(string)
		f, err := sftp.Open(remotePath)
		if err != nil {
			sock.Emit("sftp-error", "Download error: "+err.Error())
			return
		}
		defer f.Close()
		data, err := io.ReadAll(f)
		if err != nil {
			sock.Emit("sftp-error", "Download error: "+err.Error())
			return
		}
		sock.Emit("sftp-file-content", map[string]any{
			"path":    remotePath,
			"content": data,
			"name":    path.Base(remotePath),
		})
	})

	sock.On("sftp-upload", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		var payload struct {
			RemotePath string `json:"remotePath"`
			Name       string `json:"name"`
		}
		decodePayload(firstArg(args), &payload)
		var content []byte
		if len(args) > 0 {
			if m, ok := args[0].(map[string]any); ok {
				content = decodeUploadContent(m["content"])
			}
		}
		target := path.Join(payload.RemotePath, payload.Name)
		f, err := sftp.Create(target)
		if err != nil {
			sock.Emit("sftp-error", "Upload error: "+err.Error())
			return
		}
		if _, err := f.Write(content); err != nil {
			f.Close()
			sock.Emit("sftp-error", "Upload error: "+err.Error())
			return
		}
		f.Close()
		sock.Emit("sftp-upload-success", map[string]any{"name": payload.Name})
	})

	sock.On("sftp-rm", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		var payload struct {
			Path string `json:"path"`
			Type string `json:"type"`
		}
		decodePayload(firstArg(args), &payload)
		var err error
		if payload.Type == "dir" {
			err = sftp.RemoveDirectory(payload.Path)
		} else {
			err = sftp.Remove(payload.Path)
		}
		if err != nil {
			sock.Emit("sftp-error", "Delete error: "+err.Error())
		} else {
			sock.Emit("sftp-action-success", map[string]any{"action": "delete", "path": payload.Path})
		}
	})

	// sftp-read / sftp-write back the remote file editing flow (internal editor).
	sock.On("sftp-read", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		remotePath, _ := firstArg(args).(string)
		f, err := sftp.Open(remotePath)
		if err != nil {
			sock.Emit("sftp-error", "Read error: "+err.Error())
			return
		}
		defer f.Close()
		if st, err := f.Stat(); err == nil && st.Size() > 8<<20 {
			sock.Emit("sftp-error", "Read error: file too large (max 8 MB)")
			return
		}
		data, err := io.ReadAll(f)
		if err != nil {
			sock.Emit("sftp-error", "Read error: "+err.Error())
			return
		}
		sock.Emit("sftp-read-result", map[string]any{
			"path":    remotePath,
			"content": data,
			"name":    path.Base(remotePath),
		})
	})

	sock.On("sftp-write", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		var payload struct {
			Path string `json:"path"`
		}
		decodePayload(firstArg(args), &payload)
		var content []byte
		if m, ok := firstArg(args).(map[string]any); ok {
			content = decodeUploadContent(m["content"])
		}
		if payload.Path == "" {
			sock.Emit("sftp-error", "Write error: empty path")
			return
		}
		f, err := sftp.Create(payload.Path)
		if err != nil {
			sock.Emit("sftp-error", "Write error: "+err.Error())
			return
		}
		if _, err := f.Write(content); err != nil {
			f.Close()
			sock.Emit("sftp-error", "Write error: "+err.Error())
			return
		}
		f.Close()
		sock.Emit("sftp-action-success", map[string]any{"action": "write", "path": payload.Path})
	})

	sock.On("sftp-mkdir", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		var payload struct {
			Path string `json:"path"`
		}
		decodePayload(firstArg(args), &payload)
		if err := sftp.Mkdir(payload.Path); err != nil {
			sock.Emit("sftp-error", "Mkdir error: "+err.Error())
		} else {
			sock.Emit("sftp-action-success", map[string]any{"action": "mkdir", "path": payload.Path})
		}
	})

	sock.On("sftp-rename", func(args ...any) {
		sftp := getSFTP(*sessBox)
		if sftp == nil {
			return
		}
		var payload struct {
			OldPath string `json:"oldPath"`
			NewPath string `json:"newPath"`
		}
		decodePayload(firstArg(args), &payload)
		if err := sftp.Rename(payload.OldPath, payload.NewPath); err != nil {
			sock.Emit("sftp-error", "Rename error: "+err.Error())
		} else {
			sock.Emit("sftp-action-success", map[string]any{"action": "rename", "oldPath": payload.OldPath, "newPath": payload.NewPath})
		}
	})
}
