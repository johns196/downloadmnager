#!/usr/bin/env bash
# Starts everything needed to test locally on Ubuntu: backend,
# sniffer-service, and the YouTube PO token container (if the sniffer-
# service's dependencies are installed -- see sniffer-service/setup.sh).
# Extension and Flutter client are separate: load the extension unpacked
# via chrome://extensions, run the Flutter app with `flutter run`.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

port_in_use() { fuser "$1"/tcp >/dev/null 2>&1; }

echo "== Backend (127.0.0.1:8787) =="
if port_in_use 8787; then
  echo "   already running, leaving it alone"
else
  if [ ! -d "$ROOT/backend/node_modules" ]; then
    echo "   node_modules missing, running npm install first..."
    (cd "$ROOT/backend" && npm install)
  fi
  [ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
  (cd "$ROOT/backend" && nohup npm run dev > "$LOG_DIR/backend.log" 2>&1 &)
  sleep 2
  echo "   started (auto-restarts on file changes), logging to $LOG_DIR/backend.log"
fi

echo "== Sniffer service (127.0.0.1:8788) =="
if port_in_use 8788; then
  echo "   already running, leaving it alone"
elif [ ! -d "$ROOT/sniffer-service/.venv" ]; then
  echo "   .venv missing -- run sniffer-service/setup.sh first, skipping for now"
else
  (cd "$ROOT/sniffer-service" && nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8788 > "$LOG_DIR/sniffer.log" 2>&1 &)
  sleep 2
  echo "   started, logging to $LOG_DIR/sniffer.log"
fi

echo "== YouTube PO token server (127.0.0.1:4416) =="
if curl -sS --max-time 2 http://127.0.0.1:4416/ping >/dev/null 2>&1; then
  echo "   already running"
elif docker image inspect brainicism/bgutil-ytdlp-pot-provider:latest >/dev/null 2>&1; then
  docker rm -f bgutil-pot >/dev/null 2>&1 || true
  docker run -d --name bgutil-pot --restart no -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider:latest >/dev/null
  echo "   started"
else
  echo "   image not pulled yet -- YouTube extraction needs this, everything else works without it."
  echo "   Run: docker run -d --name bgutil-pot --restart no -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider:latest"
fi

echo
echo "Ready:"
echo "  Backend health:  curl http://127.0.0.1:8787/api/health"
echo "  Sniffer health:  curl http://127.0.0.1:8788/health"
echo "  Extension:       chrome://extensions -> Developer mode -> Load unpacked -> $ROOT/extension"
echo "  Ubuntu app:      $ROOT/client/dist/download-manager-client_0.1.0_amd64.deb (sudo dpkg -i ...) then open 'Download Manager' from your app menu"
echo "  Android app:     $ROOT/client/dist/download-manager-client_0.1.0.apk (adb install ..., or sideload)"
echo "  Stop everything: $ROOT/scripts/stop-dev.sh"
