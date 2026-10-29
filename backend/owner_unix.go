//go:build !windows

package main

import (
	"os"
	"os/user"
	"strconv"
	"syscall"
)

func ownerOf(fi os.FileInfo) string {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return ""
	}
	uid := strconv.Itoa(int(st.Uid))
	if u, err := user.LookupId(uid); err == nil {
		return u.Username
	}
	return uid
}
