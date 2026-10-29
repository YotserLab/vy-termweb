# VY-TermWEB

Web-based SSH/SFTP terminal and infrastructure manager. A single Go binary
serves the full panel — no external services, no cloud, everything runs on
your machine.

## Features

- **SSH terminals** — real sessions (x/crypto/ssh), resumable after
  disconnect, jump-host chains, startup macros, session groups
- **SSH tunnels** — local (`-L`), remote (`-R`) and dynamic SOCKS5 (`-D`)
- **SFTP** — file manager with upload/download, rename, delete and remote
  file editing
- **Local shell** — real PTY on Linux/macOS (ConPTY on Windows)
- **File manager** — local filesystem with thumbnails, media viewer,
  copy/cut/paste, properties
- **Text editor** — plain or Monaco (VS Code engine), edits server and
  remote files
- **Network scanner** — ping + TCP sweep, MAC/vendor lookup, port scan,
  traceroute, DNS
- **System info** — CPU/board/GPU/storage data per platform
- **Encrypted credential vault** — PBKDF2 + AES-GCM, secrets never stored
  in plaintext
- **i18n** — English, Português (BR), Español
- **Extras** — macro recording, split view, HP48G-style calculator,
  import/export of sessions

## Quick start

Requirements: **Go 1.24+** and **Node.js 20+ with pnpm**.

```bash
pnpm install
pnpm build      # frontend -> frontend/dist
pnpm dev        # Go backend serves everything on http://localhost:32230
```

For UI iteration: `pnpm dev` runs the Vite dev server on :32231 with HMR
(proxies `/api` and `/socket.io` to the backend).

## Authentication

The panel is gated end-to-end: all `/api/*` routes and sockets require a
token. On first access you create a master password (PBKDF2-SHA256 hash in
`~/.vy-termweb/auth.json`), or set `VY_MASTER_PASSWORD` before starting.

## Standalone binaries

```bash
./scripts/build-go.sh            # all targets -> dist-go/
./scripts/build-go.sh linux      # or: darwin | windows | linux/arm64 | native
```

Produces self-contained binaries (frontend embedded via `go:embed`) for
linux/darwin/windows on amd64+arm64, plus `SHA256SUMS`.

Runtime note: media thumbnails use the host `ffmpeg` binary when available.

## Debian package

```bash
./scripts/build-deb.sh           # -> dist-deb/vy-termweb_<ver>-<rev>_amd64.deb
```

Installs `/usr/bin/vy-termweb` + a systemd service (enabled and started by
postinst). Runtime user, port and password live in
`/etc/default/vy-termweb`.

## Flatpak

```bash
./scripts/build-flatpak.sh       # -> dist-flatpak/io.github.yotserlab.vytermweb.flatpak
flatpak install --user dist-flatpak/io.github.yotserlab.vytermweb.flatpak
```

Requires `flatpak-builder` and the flathub runtimes
(`org.freedesktop.Sdk//25.08` + node20/golang SDK extensions — the script
passes `--install-deps-from=flathub`). The manifest builds everything from
source; it needs network access (`flatpak-builder --share=network`).

Inside the sandbox the app requests `--filesystem=host`,
`--share=network` and `org.freedesktop.Flatpak` so that Local Shell spawns
a real **host** shell via `flatpak-spawn`, the file manager sees real
paths, and network/sysinfo tools run on the host.

## Project layout

```
frontend/    React 19 + Vite + TypeScript UI
backend/     standalone Go server (embeds frontend/dist)
packaging/   deb/ and flatpak/ sources
scripts/     dev.sh, build-go.sh, build-deb.sh, build-flatpak.sh
tests/       socket-level smoke tests (*.mjs)
```

## Tests

```bash
VY_MASTER_PASSWORD=test PORT=32240 go -C backend run . &
VY_TERMWEB_PASS=test PORT=32240 node tests/local-file-manager.mjs
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[MIT](LICENSE)
