import os
from pathlib import Path

# Port is frozen in docs/API.md -- change it there too if you change it here.
HOST = os.environ.get("SNIFFER_HOST", "127.0.0.1")
PORT = int(os.environ.get("SNIFFER_PORT", "8788"))

# Per-extraction wall-clock budgets. yt-dlp's metadata-only probe is
# usually sub-second for most sites, but YouTube specifically now involves
# reading/decrypting the browser cookie store, a round trip to the local
# PO token server, and running a JS challenge solver -- comfortably under
# 10s in testing, but given real room here since a timeout is treated the
# same as "not found" by the caller.
YTDLP_TIMEOUT_SECONDS = 30
NETWORK_SNIFF_TIMEOUT_SECONDS = 25
NETWORK_SNIFF_IDLE_WAIT_SECONDS = 6

# --- YouTube-specific extraction requirements ---
# YouTube's current anti-bot stack needs three things yt-dlp alone can't
# provide, all native-deployment-specific (they read/require state that
# only exists on the machine running a real browser -- see PROGRESS.md
# for the full chain and why this doesn't carry over to Docker):
#
# 1. An authenticated session: pass "chrome", "firefox", etc, or "" to
#    disable and get yt-dlp's default (usually bot-checked) behavior. The
#    browser named here must be actually installed and logged into
#    YouTube on this machine -- yt-dlp reads its live cookie store.
YTDLP_COOKIES_FROM_BROWSER = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "chrome")
#
# 2. A PO (proof-of-origin) token provider: the bgutil-ytdlp-pot-provider
#    pip package (see requirements.txt) talks to a small HTTP server for
#    this -- see PROGRESS.md for the `docker run
#    brainicism/bgutil-ytdlp-pot-provider` command that needs to be
#    running for extraction to work at all (not just to unlock higher
#    quality -- without it YouTube returns no usable formats). Defaults
#    to the plugin's own default (127.0.0.1:4416, correct when running
#    natively); override for docker-compose, where the server is a
#    separate service reachable by name, not by localhost.
YTDLP_POT_SERVER_BASE_URL = os.environ.get("YTDLP_POT_SERVER_BASE_URL", "")
#
# 3. A JS runtime new enough to solve YouTube's "n-parameter" challenge:
#    yt-dlp requires Node.js >= 22, which may be newer than a distro's
#    system Node package (apt's nodesource package on this box was v20,
#    and upgrading it system-wide needs sudo). setup.sh downloads a
#    portable Node into sniffer-service/.local-node/ when the system one
#    is too old; default here picks that up automatically if present,
#    otherwise falls back to empty (yt-dlp finds "node" on PATH itself,
#    fine if the system Node is already >= 22).
_local_node = Path(__file__).resolve().parent.parent / ".local-node" / "bin" / "node"
YTDLP_NODE_PATH = os.environ.get("YTDLP_NODE_PATH", str(_local_node) if _local_node.exists() else "")
