# Universal Download Manager & Media Grabber

A self-hosted, local-first download manager: a multi-threaded chunked
downloader, a media-stream sniffer (yt-dlp + headless-browser network
interception) for pulling audio/video off arbitrary pages, ffmpeg-based
conversion/tagging, a browser extension, and a Flutter client.

Everything runs on your own machine. The backend binds to `127.0.0.1`
only and has no authentication -- it is not designed to be exposed to a
network, only to be talked to by the extension and client running on the
same box.

## Scope, honestly

- **"Any website" is a target, not a guarantee.** The sniffer tries
  yt-dlp first (1800+ site-specific extractors) and falls back to passive
  network sniffing via headless Chromium for everything else. Sites that
  lazy-load media behind interaction, or that yt-dlp doesn't recognize
  and that never fire an observable network request, won't produce
  results.
- **DRM is explicitly out of scope.** Widevine/PlayReady/FairPlay-
  protected streams are detected and skipped (with a warning), never
  decrypted. There is no CDM/license-request handling anywhere in this
  codebase, on purpose.
- Respect the terms of service of sites you use this against, and only
  download content you have the right to download. This is a general-
  purpose downloader, the same category of tool as yt-dlp or a classic
  IDM -- what you point it at is your call and your responsibility.

## Layout

```
backend/           Node.js/TypeScript download engine, queue, ffmpeg
                    processing, REST + WebSocket API (port 8787)
sniffer-service/    Python/FastAPI: yt-dlp + Playwright network sniffing
                    (port 8788, internal -- only backend talks to it)
extension/          Manifest V3 browser extension (Chrome/Edge/Brave)
client/             Flutter app (desktop + mobile)
docs/API.md         The frozen contract every piece above is built against
```

Read `docs/API.md` before changing any field name, port, or enum value --
it's shared by four codebases (TS, Python, Dart, and the extension's JS)
and drift between them is the main way a scaffold like this stops working.

See `PROGRESS.md` for what's actually been built, tested, and verified
vs. what's still scaffolding, plus exact resume-here instructions for the
next session.

## Quick start (native, for development)

Once you've followed the one-time setup below at least once (`npm
install`, `sniffer-service/setup.sh`), day-to-day you can just run:

```bash
./scripts/start-dev.sh   # starts backend + sniffer-service + PO token server, skips what's already running
./scripts/stop-dev.sh    # stops all three
```

Logs land in `.dev-logs/`. The rest of this section is what those scripts
automate, spelled out for first-time setup or when something needs
debugging directly.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev          # tsx watch src/server.ts, http://127.0.0.1:8787
```

### 2. Sniffer service

The yt-dlp path works with just the lightweight Python deps. The
Playwright fallback (for sites yt-dlp doesn't support) needs one extra
one-time step because it downloads a ~200MB Chromium binary:

```bash
cd sniffer-service
./setup.sh            # venv + pip install + playwright install chromium
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8788
```

Without running `setup.sh`, the service still starts and yt-dlp-supported
sites still work -- unsupported sites return a warning telling you
Playwright isn't installed instead of a result.

**YouTube specifically** needs two more things beyond `setup.sh` --
`setup.sh` prints exact commands for both at the end, and
`PROGRESS.md`'s "Real-world site compatibility" section has the full
why: a PO token server running (`docker run` command printed by
`setup.sh`), and the browser named in `YTDLP_COOKIES_FROM_BROWSER`
(`app/config.py`, default `"chrome"`) actually installed and logged into
YouTube on this machine. Every other yt-dlp-supported site works without
either.

### 3. Browser extension

`chrome://extensions` -> enable Developer mode -> "Load unpacked" ->
select the `extension/` folder. Requires the backend to be running.

### 4. Native apps (Ubuntu desktop + Android)

Already built. Install directly, no Flutter SDK needed just to use them:

```bash
# Ubuntu -- installs as a real app with an icon in your application menu
sudo dpkg -i client/dist/download-manager-client_0.1.0_amd64.deb

# Android -- installs on a connected device/emulator
adb install client/dist/download-manager-client_0.1.0.apk
# or copy the .apk to a phone and open it directly (allow "install from
# unknown sources" -- it's release-mode but not signed for distribution)
```

To rebuild after changing `client/lib/` (Flutter SDK is installed at
`.toolchain/flutter`, not on system `PATH`):

```bash
export PATH="$PWD/.toolchain/flutter/bin:$PATH"
export JAVA_HOME="$PWD/.toolchain/jdk-17"
export ANDROID_SDK_ROOT="$PWD/.toolchain/android-sdk"   # Android builds only
cd client
flutter build linux --release   # needs: sudo apt install -y clang cmake ninja-build pkg-config libgtk-3-dev liblzma-dev (one-time)
flutter build apk --release
```

Windows isn't buildable from this machine at all (Flutter can't
cross-compile Windows targets from Linux) -- needs either a Windows
machine or a CI pipeline, see `PROGRESS.md`.

## Pointing a client at a different backend

Both the extension and the Flutter client default to the local dev
backend (`127.0.0.1:8787`), but the address is a runtime setting, not a
hardcoded constant -- useful once you're running the backend somewhere
other than the machine you're testing the client on.

- **Extension**: click the gear icon in the popup (or `chrome://extensions`
  -> this extension -> "Extension options") and set the backend URL
  there. Stored in `chrome.storage.local`, takes effect on the next
  request -- no reload needed.
- **Flutter client**: Settings tab -> Connection -> enter `host:port` and
  save. Persisted via `shared_preferences`; takes effect on next app
  launch (by design -- avoids tearing down and rebuilding every provider
  that depends on the connection mid-session).

**Before you point either at a backend reachable from anywhere but this
machine**: the backend has no authentication. `127.0.0.1`-only binding is
the *only* thing currently preventing anyone who can reach it from
queuing downloads, reading your settings, or pulling files out of
`downloads/`. Reachable-on-your-home-LAN is a real, if smaller, version
of the same exposure -- anyone else on that network could reach it too.
Don't relax `HOST` in `backend/.env` past `127.0.0.1`, and don't port-
forward or tunnel it to the public internet, until an auth layer exists.
That's not built yet; it's the actual blocker for "put it online," not a
config value.

## Docker (production-style deployment)

```bash
docker compose up --build
```

Brings up `backend` (published to `127.0.0.1:8787` only) and
`sniffer-service` (internal-only, reached over the compose network) using
Microsoft's Playwright image so the browser binary is already baked in.
Downloads/DB persist in named volumes. Not built/run as part of this
scaffold's verification pass -- `docker compose config` was validated,
but see PROGRESS.md for what that does and doesn't confirm.

Both services use `restart: "no"` deliberately: nothing in this stack
should silently come back up after a host reboot without you starting it.

## Verified vs. scaffolded

PROGRESS.md has the full breakdown with commands and bugs found/fixed
along the way. Short version: the backend and sniffer-service were
actually run and exercised end-to-end (chunked parallel downloads,
pause/resume, integrity hashing, sniff -> grab -> download ->
extract-audio-to-MP3 -> ID3 tagging, all against real HTTP servers). The
extension was statically validated (manifest, all JS, MV3-specific
correctness issues fixed) but couldn't be loaded in a real browser in
this headless environment. The Flutter client is hand-written source that
has never been compiled.
