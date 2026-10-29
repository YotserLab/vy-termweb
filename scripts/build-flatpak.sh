#!/usr/bin/env bash
# Build a Flatpak bundle for VY-TermWEB (builds frontend + Go backend from
# source inside the org.freedesktop.Sdk, then bundles an OSTree repo export).
#
# Usage:
#   ./scripts/build-flatpak.sh        # -> dist-flatpak/io.github.c4tom.vytermweb.flatpak
#
# Requirements (user install is enough):
#   flatpak-builder, plus the flathub remote with
#   org.freedesktop.Platform/Sdk//25.08 and the node20 + golang SDK extensions.
#   flatpak-builder --install-deps-from=flathub resolves missing runtimes.
#
# The build needs network (pnpm install + go mod download) → --share=network.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="io.github.c4tom.vytermweb"
MANIFEST="$ROOT/packaging/flatpak/$APP_ID.yml"
BUILD_DIR="$ROOT/build-dir"
REPO="$ROOT/flatpak-repo"
OUT_DIR="$ROOT/dist-flatpak"

command -v flatpak-builder >/dev/null || {
  echo "error: flatpak-builder not found." >&2
  echo "  Fedora: sudo dnf install flatpak-builder" >&2
  echo "  or:     flatpak install flathub org.flatpak.Builder" >&2
  exit 1
}

echo "==> flatpak-builder ($APP_ID)"
flatpak-builder --share=network --force-clean \
  --install-deps-from=flathub \
  --repo="$REPO" "$BUILD_DIR" "$MANIFEST"

mkdir -p "$OUT_DIR"
BUNDLE="$OUT_DIR/$APP_ID.flatpak"
rm -f "$BUNDLE"
flatpak build-bundle "$REPO" "$BUNDLE" "$APP_ID"

echo
echo "Built: $BUNDLE"
echo "Install: flatpak install --user $BUNDLE"
