//go:build windows

package main

import "os"

func ownerOf(fi os.FileInfo) string { return "" }
