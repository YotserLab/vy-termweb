#!/usr/bin/env bash
# Build VY-TermWEB Go binaries for Linux, macOS and Windows.
#
# Usage:
#   ./scripts/build-go.sh                 # all targets
#   ./scripts/build-go.sh linux           # linux amd64 + arm64
#   ./scripts/build-go.sh darwin          # macOS amd64 + arm64
#   ./scripts/build-go.sh windows         # windows amd64 + arm64
#   ./scripts/build-go.sh linux/arm64     # single target
#   ./scripts/build-go.sh native          # host platform only
#
# Env:
#   SKIP_FRONTEND=1   reuse the existing frontend/dist instead of `pnpm build`
#   OUT_DIR=path      output directory (default: dist-go)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_DIR="$ROOT/backend"
OUT_DIR="${OUT_DIR:-$ROOT/dist-go}"
BINARY="vy-termweb"

ALL_TARGETS=(
  linux/amd64
  linux/arm64
  darwin/amd64
  darwin/arm64
  windows/amd64
  windows/arm64
)

want_targets() {
  local sel="${1:-all}"
  case "$sel" in
    all)     printf '%s\n' "${ALL_TARGETS[@]}" ;;
    native)  printf '%s/%s\n' "$(go env GOOS)" "$(go env GOARCH)" ;;
    linux|darwin|windows)
      printf '%s\n' "${ALL_TARGETS[@]}" | grep "^$sel/" ;;
    */*)     printf '%s\n' "$sel" ;;
    *) echo "unknown target: $sel" >&2; exit 2 ;;
  esac
}

TARGETS=($(want_targets "${1:-all}"))
[ ${#TARGETS[@]} -gt 0 ] || { echo "no targets matched" >&2; exit 2; }

# --- frontend -------------------------------------------------------------
if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  echo "==> pnpm build (frontend)"
  pnpm -C "$ROOT/frontend" build
fi

[ -f "$ROOT/frontend/dist/index.html" ] || {
  echo "error: $ROOT/frontend/dist/index.html missing — run \`pnpm build\` first" >&2
  exit 1
}

echo "==> syncing frontend/dist -> backend/dist (go:embed)"
rm -rf "$GO_DIR/dist"
cp -a "$ROOT/frontend/dist" "$GO_DIR/dist"

# --- compile ----------------------------------------------------------------
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/SHA256SUMS"

cd "$GO_DIR"
for t in "${TARGETS[@]}"; do
  GOOS="${t%%/*}"
  GOARCH="${t##*/}"
  out="$OUT_DIR/$BINARY-$GOOS-$GOARCH"
  [ "$GOOS" = "windows" ] && out="$out.exe"
  echo "==> $GOOS/$GOARCH -> $(basename "$out")"
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
    go build -trimpath -ldflags="-s -w" -o "$out" .
done

# --- checksums ----------------------------------------------------------------
(cd "$OUT_DIR" && sha256sum vy-termweb-* > SHA256SUMS 2>/dev/null || shasum -a 256 vy-termweb-* > SHA256SUMS)

echo
echo "Built ${#TARGETS[@]} binary(ies) in $OUT_DIR:"
ls -lh "$OUT_DIR"/vy-termweb-* | awk '{print "  " $NF " (" $5 ")"}'
echo "  SHA256SUMS"
