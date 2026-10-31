#!/bin/sh
# The data volume is created by the host (often root-owned). Fix ownership, then drop to the unprivileged
# "node" user so the app does not run as root. If the container lacks the capabilities to do so
# (CHOWN / SETUID / SETGID dropped, rootless Docker, user namespaces...), keep running instead of crash-looping.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/data 2>/dev/null || echo "WARN: could not chown /app/data (missing CHOWN capability?)"
  if su-exec node true 2>/dev/null; then
    exec su-exec node "$@"
  fi
  echo "WARN: cannot drop privileges to 'node' (missing SETUID/SETGID capability?), running as the container user"
fi
exec "$@"
