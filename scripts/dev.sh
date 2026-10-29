#!/usr/bin/env bash
# Dev: Go backend (:32230) + Vite dev server with HMR (:32231).
# Vite proxies /api and /socket.io to the backend. Open http://localhost:32231
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# go:embed all:dist needs the dir to exist at compile time (it's gitignored).
mkdir -p backend/dist
[ -n "$(ls -A backend/dist)" ] || touch backend/dist/.placeholder

# If a frontend build exists, serve it on the backend port too.
DIST_ENV=()
[ -f frontend/dist/index.html ] && DIST_ENV=("DIST_DIR=$ROOT/frontend/dist")

trap 'kill 0' EXIT INT TERM

env PORT="${BACKEND_PORT:-32230}" NO_OPEN="${NO_OPEN:-1}" "${DIST_ENV[@]}" go -C backend run . &
(cd frontend && pnpm exec vite)
