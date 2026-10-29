# VY-TermWEB Project Rules

## Layout

- `frontend/` — React 19 + Vite + TS UI (own package.json; pnpm workspace at root)
- `backend/` — standalone Go server, embeds `backend/dist` (`go:embed all:dist`)
- `packaging/` — `deb/` + `flatpak/` sources
- `scripts/` — dev.sh, build-go.sh, build-deb.sh, build-flatpak.sh
- `tests/` — socket-level smoke tests (*.mjs)
- `HANDOFF.md` / `LOGWORK.md` — internal notes, gitignored on purpose

## Build / Verify

```bash
pnpm install            # workspace install (frontend)
pnpm lint               # tsc --noEmit (frontend)
pnpm build              # Vite production build -> frontend/dist
pnpm dev                # Go backend :32230 + Vite dev server :32231 (HMR)
./scripts/build-go.sh   # cross-compile Go backend -> dist-go/ (linux/darwin/windows, amd64+arm64)
./scripts/build-deb.sh  # build .deb (systemd service) -> dist-deb/
./scripts/build-flatpak.sh  # flatpak bundle -> dist-flatpak/
cd backend && go vet . && go build .
```

## Runtime Tests

- `/api/system/status` — server info + version
- `/api/local-fs?path=/` — list local filesystem
- Socket events for real features:
  - `local-shell` — PTY local shell (Go backend)
  - `ssh-connect` + `ssh-input` — real SSH/SFTP
  - `net-scan` — TCP + ping subnet sweep

## Auth (master password)

- The panel is gated end-to-end: `/api/*` and `/socket.io/*` require a token
  (Bearer header or `?token=`); set `VY_MASTER_PASSWORD` or complete the
  first-run setup screen (hash in `~/.vy-termweb/auth.json`).
- Run test servers with `VY_MASTER_PASSWORD=<pass>` and tests with
  `VY_TERMWEB_PASS=<pass>` — tests never complete first-run setup themselves.

## Flatpak

- `backend/flatpak.go` — `inFlatpak()` (FLATPAK_ID) + `hostCommand()` wrap
  host operations via `flatpak-spawn --host` (shell PTY, xdg-open,
  ip/ping/traceroute, ffmpeg, lscpu/dmidecode/lspci, df).
- Manifest: `packaging/flatpak/io.github.yotserlab.vytermweb.yml` — builds from
  source (node20 + golang SDK ext); requires `flatpak-builder --share=network`.
- finish-args: `--share=network`, `--filesystem=host`,
  `--talk-name=org.freedesktop.Flatpak` (sysadmin tool — host access is the point).

## Conventions

- React 19, functional components, `type` imports preferred
- Avoid mock data in UI; every control should do something real or be removed
- `@google/genai` / `GEMINI_API_KEY` no longer used
- Commit messages in conventional commit format
