#!/usr/bin/env bash
# One-time setup for the sniffer-service. Not run automatically by anything
# else in this repo -- the Playwright browser download alone is 150-300MB,
# so this is a deliberate, explicit step.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Downloads the Chromium binary Playwright drives. Requires network access.
playwright install chromium
# Linux system libraries Chromium needs that aren't always present;
# harmless to skip if your distro already has them (needs sudo).
playwright install-deps chromium || true

# --- YouTube extraction requirements ---
# See app/config.py for the full explanation of why each of these exists.
# None of this is needed for the majority of yt-dlp-supported sites --
# only YouTube's specific anti-bot stack requires all three.

# yt-dlp's JS challenge solver needs Node.js >= 22. If the system Node is
# older (common -- many distros ship an LTS well behind current), download
# a portable copy here rather than requiring a system-wide upgrade (which
# usually needs sudo). config.py auto-detects this directory if present.
NODE_MIN_MAJOR=22
system_node_major="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)"
if [ "${system_node_major:-0}" -lt "$NODE_MIN_MAJOR" ]; then
  echo "System Node.js is older than v$NODE_MIN_MAJOR (or missing) -- downloading a portable copy into .local-node/"
  NODE_VERSION="v22.14.0"
  mkdir -p .local-node
  curl -sSL -o /tmp/node-portable.tar.xz \
    "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  tar -xf /tmp/node-portable.tar.xz --strip-components=1 -C .local-node
  rm /tmp/node-portable.tar.xz
  .local-node/bin/node -v
else
  echo "System Node.js v$system_node_major is new enough, skipping portable download."
fi

cat <<'EOF'

Setup complete. Two more things needed for YouTube extraction specifically
(everything else -- Dailymotion, direct links, the Playwright fallback --
works without them):

1. Start the PO token provider server (one-time per boot, not part of this
   repo's own services since it's a general-purpose yt-dlp dependency):

     docker run -d --name bgutil-pot --restart no \
       -p 127.0.0.1:4416:4416 brainicism/bgutil-ytdlp-pot-provider:latest

2. Make sure the browser named in YTDLP_COOKIES_FROM_BROWSER (default:
   "chrome", see app/config.py) is actually installed and logged into
   YouTube on this machine -- yt-dlp reads its live cookie store to look
   like an authenticated session. Set YTDLP_COOKIES_FROM_BROWSER="" to
   disable this (YouTube will then hit its bot-check and fail).

Run the service with: .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8788
EOF
