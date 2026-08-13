#!/usr/bin/env bash
# Stops everything start-dev.sh started. Port-based (not PID-tracked --
# nohup'd background subshells make PID tracking unreliable across bash
# versions; killing by the port a service is known to bind is simpler
# and is exactly how this was done throughout development).
set -uo pipefail

stop_port() {
  local port="$1" name="$2"
  if fuser "$port"/tcp >/dev/null 2>&1; then
    fuser -k "$port"/tcp >/dev/null 2>&1
    echo "stopped $name (port $port)"
  else
    echo "$name (port $port) was not running"
  fi
}

stop_port 8787 "backend"
stop_port 8788 "sniffer-service"

if docker ps --format "{{.Names}}" 2>/dev/null | grep -qx bgutil-pot; then
  docker stop bgutil-pot >/dev/null && echo "stopped bgutil-pot (YouTube PO token server)"
else
  echo "bgutil-pot was not running"
fi
