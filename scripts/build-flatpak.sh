#!/usr/bin/env bash
# Build a Flatpak bundle for VY-TermWEB (builds frontend + Go backend from
# source inside the org.freedesktop.Sdk, then bundles an OSTree repo export).
#
# Usage:
#   ./scripts/build-flatpak.sh        # -> dist-flatpak/io.github.yotserlab.vytermweb.flatpak
#
# Requirements (user install is enough):
#   flatpak-builder (or `flatpak install flathub org.flatpak.Builder`), plus
#   org.freedesktop.Platform/Sdk//25.08 and the node20 + golang SDK extensions
#   (--install-deps-from=flathub resolves missing runtimes).
#
# The build needs network (pnpm install + go mod download) — granted via
# `build-args: [--share=network]` in the manifest, not a CLI flag.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="io.github.yotserlab.vytermweb"
FLATPAK_DIR="$ROOT/packaging/flatpak"
MANIFEST="$FLATPAK_DIR/$APP_ID.yml"

# --repack <linux-binary>: skip the source build and repackage an existing
# binary (used by CI: the release binaries job builds once, this only packs).
if [ "${1:-}" = "--repack" ]; then
  BIN_SRC="${2:?usage: build-flatpak.sh --repack <path-to-linux-binary>}"
  MANIFEST="$FLATPAK_DIR/$APP_ID.repack.yml"
  mkdir -p "$FLATPAK_DIR/repack"
  install -m 0755 "$BIN_SRC" "$FLATPAK_DIR/repack/vy-termweb"
  for f in desktop metainfo.xml svg; do
    install -m 0644 "$FLATPAK_DIR/$APP_ID.$f" "$FLATPAK_DIR/repack/"
  done
  trap 'rm -rf "$FLATPAK_DIR/repack"' EXIT
fi
BUILD_DIR="$ROOT/build-dir"
REPO="$ROOT/flatpak-repo"
OUT_DIR="$ROOT/dist-flatpak"
# Builder state (source copies, caches, pnpm store) is heavy — keep it off
# slow mounts (e.g. NFS). Override with FB_STATE_DIR.
STATE_DIR="${FB_STATE_DIR:-$HOME/.cache/vy-termweb-flatpak-builder}"
mkdir -p "$STATE_DIR"

if command -v flatpak-builder >/dev/null; then
  BUILDER=(flatpak-builder)
elif flatpak info org.flatpak.Builder >/dev/null 2>&1; then
  BUILDER=(flatpak run org.flatpak.Builder)
else
  echo "error: flatpak-builder not found." >&2
  echo "  Fedora: sudo dnf install flatpak-builder" >&2
  echo "  or:     flatpak install flathub org.flatpak.Builder" >&2
  exit 1
fi

echo "==> flatpak-builder ($APP_ID)"
# --user: resolve runtimes/deps from the per-user installation — also the only
# mode that works on CI runners (no system polkit/dbus for system installs).
# --disable-rofiles-fuse + --keep-build-dirs: pnpm's store files are read-only
# (mode 444), so the builder's own rm of the build dir fails on some mounts —
# keep the dirs and clean them ourselves below.
"${BUILDER[@]}" --user --force-clean --disable-rofiles-fuse --keep-build-dirs \
  --state-dir="$STATE_DIR" \
  --install-deps-from=flathub \
  --repo="$REPO" "$BUILD_DIR" "$MANIFEST"

chmod -R u+w "$STATE_DIR/build" 2>/dev/null || true
rm -rf "$STATE_DIR/build"

mkdir -p "$OUT_DIR"
BUNDLE="$OUT_DIR/$APP_ID.flatpak"
rm -f "$BUNDLE"
flatpak build-bundle "$REPO" "$BUNDLE" "$APP_ID"

echo
echo "Built: $BUNDLE"
echo "Install: flatpak install --user $BUNDLE"
