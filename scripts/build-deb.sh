#!/usr/bin/env bash
# Build a .deb package for VY-TermWEB (systemd service).
#
# Usage:
#   ./scripts/build-deb.sh              # amd64 package
#   ./scripts/build-deb.sh arm64        # arm64 package
#
# Env:
#   SKIP_FRONTEND=1   reuse the existing frontend/dist instead of `pnpm build`
#   SKIP_BUILD=1      reuse an existing dist-go/vy-termweb-linux-<arch> binary
#   DEB_REVISION=N    debian revision suffix (default: 1)
#   OUT_DIR=path      output directory (default: dist-deb)
#
# Layout installed by the package:
#   /usr/bin/vy-termweb                server binary (frontend embedded)
#   /usr/lib/vy-termweb/launch         privilege-drop launcher (setpriv)
#   /lib/systemd/system/vy-termweb.service
#   /etc/default/vy-termweb            RUN_AS_USER / PORT / SHELL (conffile)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT/packaging/deb"
ARCH="${1:-amd64}"
DEB_REVISION="${DEB_REVISION:-1}"
OUT_DIR="${OUT_DIR:-$ROOT/dist-deb}"
BINARY="vy-termweb"

# Debian arch names happen to match Go arch names for amd64/arm64.
case "$ARCH" in
  amd64|arm64) GOARCH="$ARCH" ;;
  *) echo "unsupported arch for this script: $ARCH (map it to a GOARCH first)" >&2; exit 2 ;;
esac

VERSION="$(sed -n 's/^const appVersion = "\(.*\)"$/\1/p' "$ROOT/backend/main.go" | head -1)"
[ -n "$VERSION" ] || { echo "error: could not read appVersion from backend/main.go" >&2; exit 1; }
DEB_VERSION="$VERSION-$DEB_REVISION"
PKG_NAME="${BINARY}_${DEB_VERSION}_${ARCH}"
STAGE="$OUT_DIR/$PKG_NAME"

# --- binary -----------------------------------------------------------------
BIN_PATH="$ROOT/dist-go/$BINARY-linux-$GOARCH"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  OUT_DIR="$ROOT/dist-go" "$ROOT/scripts/build-go.sh" "linux/$GOARCH"
fi
[ -f "$BIN_PATH" ] || { echo "error: $BIN_PATH missing" >&2; exit 1; }

# --- stage ------------------------------------------------------------------
echo "==> staging $PKG_NAME"
rm -rf "$STAGE"
install -d \
  "$STAGE/DEBIAN" \
  "$STAGE/usr/bin" \
  "$STAGE/usr/lib/vy-termweb" \
  "$STAGE/lib/systemd/system" \
  "$STAGE/etc/default" \
  "$STAGE/usr/share/doc/vy-termweb"

install -m 0755 "$BIN_PATH" "$STAGE/usr/bin/vy-termweb"
install -m 0755 "$PKG_DIR/launch.sh" "$STAGE/usr/lib/vy-termweb/launch"
install -m 0644 "$PKG_DIR/vy-termweb.service" "$STAGE/lib/systemd/system/vy-termweb.service"
install -m 0644 "$PKG_DIR/vy-termweb.default" "$STAGE/etc/default/vy-termweb"
install -m 0644 "$PKG_DIR/copyright" "$STAGE/usr/share/doc/vy-termweb/copyright"

sed -e "s/@VERSION@/$DEB_VERSION/" -e "s/@ARCH@/$ARCH/" \
  "$PKG_DIR/control" > "$STAGE/DEBIAN/control"
install -m 0644 "$PKG_DIR/conffiles" "$STAGE/DEBIAN/conffiles"
for s in postinst prerm postrm; do
  install -m 0755 "$PKG_DIR/$s" "$STAGE/DEBIAN/$s"
done

# --- build ------------------------------------------------------------------
mkdir -p "$OUT_DIR"
DEB="$OUT_DIR/$PKG_NAME.deb"
rm -f "$DEB"
dpkg-deb --root-owner-group --build "$STAGE" "$DEB"

echo
echo "Built: $DEB"
dpkg-deb --info "$DEB" | sed 's/^/  /'
