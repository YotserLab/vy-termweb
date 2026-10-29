#!/bin/sh
# VY-TermWEB service launcher.
#
# systemd cannot expand variables in User=, so the unit starts as root and
# this script drops privileges to $RUN_AS_USER (from /etc/default/vy-termweb)
# via setpriv, which exec()s the server in-place — signals and exit status
# propagate directly to systemd.
set -eu

if [ -z "${RUN_AS_USER:-}" ]; then
  echo "vy-termweb: RUN_AS_USER is not set — edit /etc/default/vy-termweb" >&2
  exit 1
fi

if ! uid="$(id -u "$RUN_AS_USER" 2>/dev/null)"; then
  echo "vy-termweb: user '$RUN_AS_USER' does not exist — fix /etc/default/vy-termweb" >&2
  exit 1
fi
gid="$(id -g "$RUN_AS_USER")"
entry="$(getent passwd "$RUN_AS_USER")"
home="$(printf '%s' "$entry" | cut -d: -f6)"
shell="$(printf '%s' "$entry" | cut -d: -f7)"

export NO_OPEN=1
export USER="$RUN_AS_USER" LOGNAME="$RUN_AS_USER"
[ -n "$home" ] && export HOME="$home"
[ -z "${SHELL:-}" ] && [ -n "$shell" ] && export SHELL="$shell"

# Already the target user (e.g. manual run): exec directly — setgroups(2)
# needs root, so setpriv would fail for a non-privileged same-uid drop.
if [ "$(id -u)" = "$uid" ]; then
  exec /usr/bin/vy-termweb
fi
exec setpriv --reuid "$uid" --regid "$gid" --init-groups /usr/bin/vy-termweb
