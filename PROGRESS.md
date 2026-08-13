# Progress — Universal Download Manager & Media Grabber

Last updated: 2026-08-13 (initial build session, a same-day follow-up
fixing real-world YouTube/Dailymotion/Anghami extraction, a third
session — spanning a clean pause/resume across a machine shutdown —
building installable native apps for Ubuntu and Android, and a fourth
same-day session pushing to GitHub and getting Windows building + iOS
compiling via CI).

Read this before doing further work here. See also `README.md` (setup
instructions, scope/legal notes) and `docs/API.md` (the frozen contract
every piece is built against — check it before renaming any field).

## Native app builds (Ubuntu + Android)

The user asked, in effect, "where's the actual app, like IDM has" —
correctly pointing out that `client/lib/` being verified-to-compile
(previous session) still isn't the same as something installable. This
session got real installable builds for two of the three platforms
discussed; the third (Windows) was explicitly deprioritized by the user,
not attempted.

**Toolchain, installed fresh this session, self-contained under
`/var/www/DownloadManager/.toolchain/`** (git-ignored, a few GB, not part
of the shipped product):
- Flutter SDK 3.27.1 (`.toolchain/flutter`) — not on system PATH, export
  `PATH="/var/www/DownloadManager/.toolchain/flutter/bin:$PATH"` first.
- Portable JDK 17 / Temurin (`.toolchain/jdk-17`) — export `JAVA_HOME` to
  this path. Needed because Android's Gradle build requires a JDK and the
  box has none installed system-wide.
- Android SDK (`.toolchain/android-sdk`), self-contained command-line
  tools install, no sudo used anywhere in this one. Ended up needing
  three separate build-tools/platform versions across the build attempts
  (`build-tools;34.0.0` installed proactively, then `build-tools;33.0.1`
  and `platforms;android-35` turned out to be required too and were
  pulled in — the first mid-build, the second automatically by Gradle
  once "all licenses" had been pre-accepted). If a future Flutter/Gradle
  upgrade demands yet another version, `sdkmanager --sdk_root=<path>
  "<package>"` is the pattern; `flutter doctor -v`'s "Android toolchain"
  section confirms what's currently registered.
- Registered with Flutter via `flutter config --android-sdk <path>`
  (persisted in Flutter's own global config).

**`flutter analyze` was run for the first time ever on the hand-written
`client/lib/` from the original scaffolding session: zero real errors.**
The only issue was in `test/widget_test.dart`, a default file `flutter
create` generates itself (not something written for this project) that
referenced a `MyApp` class that doesn't exist in this app — replaced with
a correct smoke test that pumps the real `DownloadManagerApp` and checks
it builds one frame without throwing. Worth noting for confidence in the
original scaffolding session's quality: a full Flutter app (models,
services, state management, five screens, custom widgets) written without
ever once running the compiler had, in the end, one wrong import's worth
of actual problems.

**Ubuntu desktop app — built, packaged, and confirmed running (not just
compiled).**
- Needed one sudo step, run by the user, not by the agent:
  `sudo apt install -y clang cmake ninja-build pkg-config libgtk-3-dev liblzma-dev`
  (standard Linux/GTK build tooling, nothing project-specific).
- `flutter build linux --release` succeeded on the first attempt once
  those were installed.
- Packaged as a real `.deb`
  (`client/dist/download-manager-client_0.1.0_amd64.deb`, ~7.9MB) by hand
  with `dpkg-deb` — `DEBIAN/control`, a `.desktop` entry (so it shows up
  in the application menu/launcher like a normal app, not just a binary
  you run from a terminal), and the app icon reused from
  `extension/icons/icon128.png` for consistent branding across the
  extension/Linux app/Android app.
- **Confirmed actually running**, not just built: launched the compiled
  binary directly against this machine's real (Wayland/XWayland) desktop
  session, confirmed the process stays alive and consumes real CPU/memory
  consistent with active rendering (a screenshot tool failed on Wayland
  permission grounds, not because the app failed — see the session
  transcript around this point if the distinction matters later).
- Install: `sudo dpkg -i client/dist/download-manager-client_0.1.0_amd64.deb`.
  Uninstall: `sudo apt remove download-manager-client`.

**Android APK — built successfully, confirmed valid.**
- `flutter build apk --release` → `client/build/app/outputs/flutter-apk/app-release.apk`,
  copied to `client/dist/download-manager-client_0.1.0.apk` (~22.7MB).
- First attempt hit a real interruption: the user needed to shut their
  machine down ~16 minutes into the first build (mid-download of
  `build-tools;33.0.1`, discovered only because the build needed it).
  Stopped *cleanly* rather than killed by shutdown —
  `./gradlew --stop` (from `client/android/`) for the Gradle daemon,
  `scripts/stop-dev.sh` for backend/sniffer/PO-token-container. Gradle's
  own dependency cache (`~/.gradle`) survived on disk across the
  shutdown, confirmed by the resumed build taking 24 seconds instead of
  the ~16-25 minutes a cold build takes — this is the concrete evidence
  that "pause cleanly, resume later" actually worked as intended, not
  just a theoretical claim.
- Verified with `aapt dump badging` (from the Android build-tools) rather
  than trusting "the build didn't error": correct package metadata,
  `minSdkVersion 21`, `targetSdkVersion 35`.
- Fixed two cosmetic defaults `flutter create` leaves in place, since
  they'd otherwise ship as "download_manager_client" everywhere a user
  sees the app: `android:label` in
  `android/app/src/main/AndroidManifest.xml` (was the raw package name,
  now "Download Manager"), and all five `mipmap-*/ic_launcher.png`
  density variants (was Flutter's default logo, now the same icon used
  for the extension and the Linux app, generated via PIL resize from
  `extension/icons/icon128.png`).
- Install on a device/emulator: `adb install client/dist/download-manager-client_0.1.0.apk`,
  or copy the file to a phone and open it directly (Android will prompt
  to allow install from unknown sources for an unsigned APK like this
  one — it's release-mode but not signed with a distribution key, fine
  for personal use, would need proper signing before any app-store or
  wider distribution).

**Windows — done, via GitHub Actions CI, verified.** This project is now
a git repo pushed to `https://github.com/johns196/downloadmnager`
(public — flagged to the user, their call whether to flip it private).
`.github/workflows/build-client.yml` builds all four platforms
(windows-latest, ubuntu-latest × 2, macos-latest for iOS) on every push
to `main` touching `client/**`, or on manual `workflow_dispatch`.

The first two CI runs failed, both for reasons only discoverable by
actually running on a real Windows runner (impossible on this dev
machine) — real bugs found and fixed, not configuration guesses:
1. **"No Windows desktop project configured."** `flutter create` had
   only ever been run locally with `--platforms=linux,android` (the two
   this machine could build), so `client/windows/` never existed. Fixed:
   ran `flutter create --platforms=windows .` (added the runner folder
   without touching existing `android/`/`linux/`/`lib/`; also had to
   manually restore the `android`/`linux` entries in `client/.metadata`
   that command incorrectly dropped instead of appending to).
2. **CMake error: "Generator Visual Studio 16 2019 could not find any
   instance of Visual Studio."** Traced into Flutter 3.27.1's own
   source (`flutter_tools/lib/src/windows/visual_studio.dart`): its
   `cmakeGenerator` getter only special-cases detected major version
   `17` (→ "Visual Studio 17 2022") and falls back to hardcoding the
   "Visual Studio 16 2019" generator string for anything else — and
   whatever VS2022 build `windows-latest` actually has apparently didn't
   parse as major version 17 under this Dec-2024-era Flutter release.
   Fixed by *not* pinning the Windows CI job to the same Flutter version
   used locally (3.27.1) — it now uses current `stable` instead, unpinned,
   while Linux/Android stay pinned to 3.27.1 (the exact version already
   validated by a real local build, deliberately not touched).

**Verified, not just "build succeeded"**: downloaded the actual
`download-manager-client-windows` CI artifact and ran `file` on the
extracted `.exe` and `.dll` — confirmed genuine `PE32+ executable (GUI)
x86-64, for MS Windows`, not a truncated or corrupt output. All three
platform artifacts now sit together in `client/dist/` with consistent
naming (`download-manager-client_0.1.0_amd64.deb`,
`..._0.1.0.apk`, `..._0.1.0_windows-x64.zip`).

**iOS — unsigned `.ipa` built and verified, real device install still
needs the user's own signing step.** User first asked for a
compile-check only (given the real tradeoff: unlike Windows/Android,
iOS enforces code signing at the OS level with no
unsigned-but-installable path — no SmartScreen-style click-through, no
APK-style sideload). Added `client/ios/` (same
`flutter create --platforms=ios .` pattern as Windows, same
`.metadata` platform-list-gets-overwritten quirk, fixed the same way)
and a `build-ios` job on `macos-latest` running
`flutter build ios --release --no-codesign`.

User then asked to actually test on a real iPhone XR. Extended the same
job to package the unsigned `Runner.app` into a properly-structured
`.ipa` (`Payload/Runner.app/...` zipped — the format any iOS installer
expects) rather than leaving it as a bare `.app`. **Verified the
structure directly**: downloaded the CI artifact, unzipped it, confirmed
`Payload/Runner.app/` layout with `Runner` (the executable),
`Info.plist`, `Frameworks/App.framework`, etc. — a real, well-formed
.ipa, not a placeholder. Copied to
`client/dist/download-manager-client_0.1.0_unsigned.ipa`.

**This still will not install on the iPhone XR as-is.** Unsigned code is
categorically refused by iOS regardless of "just testing" vs.
"publishing" intent — there is no dev-mode bypass for this on a
non-jailbroken device. The remaining step has to happen on the user's
own machine with their own Apple ID, not here:
- **Free Apple ID + Sideloadly or AltStore** (Windows or Mac): these
  tools take an unsigned `.ipa` like this one and sign it themselves
  using the user's Apple ID during the sideload process — no Xcode
  required. Self-expires after 7 days (free-tier Apple limitation, not a
  tool limitation), needs re-sideloading after that.
- **Free Apple ID + Xcode directly** (Mac only): same 7-day limitation,
  install via USB cable instead of a sideloading tool.
- **Paid Apple Developer Program membership** ($99/year): would let this
  become a properly signed CI build (TestFlight or ad-hoc) instead of an
  unsigned artifact requiring a separate sideloading step — not set up,
  needs the user's account/cost decision first.

**Also found and fixed while reviewing what `git add --dry-run` would
stage** (a genuinely useful side effect of checking what's about to be
committed): `applyPostProcess` in `QueueManager.ts` never cleaned up its
temp file (`.{job.id}{ext}`, written next to the final output during
extract-audio/transcode/remux) if the ffmpeg step threw — pause, crash,
or a real ffmpeg failure all leaked it. This is exactly how two orphaned
67MB `.{uuid}.mp3` files ended up sitting in `backend/downloads/`
undetected until this review (deleted; they were dev-session test
residue, not anything the user needed). Fixed with a try/catch around the
ffmpeg call that removes the temp file before re-throwing. **Verified**
via the API with a deliberately-invalid `targetContainer` (forces
`ffmpeg.extractAudio` to throw before ever spawning ffmpeg) — confirmed
no temp file appears and the job correctly reports `state: error` with
the underlying message, rather than either silently succeeding or
leaking a file.

## What this is

Scaffolded from scratch in one session at `/var/www/DownloadManager`:
`backend/` (Node/TS download engine + queue + ffmpeg processing + REST/WS
API), `sniffer-service/` (Python/FastAPI, yt-dlp + Playwright network
sniffing), `extension/` (Manifest V3), `client/` (Flutter, hand-written).

## What's actually been verified (not just written)

Backend and sniffer-service were run and exercised against real servers,
not just typechecked. In order, what was tested and what broke along the
way:

1. **Chunked parallel downloader** — `POST /api/jobs` against a
   self-hosted 5MB range-server file with 4 chunks: correct sha256 on
   completion, pause/resume state transitions work.
2. **Found and fixed a real correctness bug**: Node's `fetch` transparently
   decompresses gzip bodies but `Content-Length` still reports the
   *compressed* size, so probing a gzip-serving host (e.g. GitHub raw)
   produced a `sizeBytes` that didn't match actual bytes, causing 416s on
   later chunks. Fixed by sending `Accept-Encoding: identity` on every
   downloader request — see the comment in
   `backend/src/core/downloader/probeUrl.ts`.
3. **Sniffer-service yt-dlp path** — confirmed working end-to-end against
   a real direct-file URL (returns proper `StreamDescriptor`s). Tested
   against YouTube too: yt-dlp itself failed there with YouTube's current
   bot-check ("Sign in to confirm you're not a bot") — an external
   site restriction, not a bug in this code; confirmed the wrapper
   degrades cleanly (falls through to the network-sniff warning) rather
   than crashing.
4. **Sniff → grab → download → extract-audio → tag → verify**, full
   pipeline, tested twice:
   - Found and fixed: `StreamDescriptor.id` is generated fresh on every
     raw sniffer-service call, so `POST /sniff/grab` (which re-resolves
     the page to find the id) could never find an id the client already
     had. Fixed with a 5-minute per-URL cache in
     `backend/src/core/sniffer/SnifferClient.ts` — see the comment there
     for the tradeoff (stale signed URLs on sites that use them).
   - Found and fixed: `createJobFromSniff` was naming the *initial*
     download file after the postProcess *target* container (e.g.
     downloading to `foo.mp3` when the plan was to extract audio to mp3),
     so ffmpeg got asked to convert a file into itself and refused.
     Fixed in `QueueManager.createJobFromSniff` to always name the raw
     download after the *source* container; `applyPostProcess` was also
     hardened to always render through a temp path rather than assuming
     source/target extensions differ.
   - Found and fixed: the SQLite `upsertStmt` in `backend/src/db/database.ts`
     excluded `filename`/`output_path` from its `ON CONFLICT DO UPDATE
     SET` clause, so a post-process rename never made it to the DB (or
     therefore the API) even though the file on disk was correctly
     renamed. Every job field needs to be in that UPDATE SET or it
     silently freezes at insert-time — worth remembering if you add
     fields to `DownloadJob` later.
   - Verified: ID3 tags (title/artist/album) land correctly on the
     output MP3 (`ffprobe -show_entries format_tags` confirmed).
5. **Settings and schedule endpoints** round-tripped correctly
   (`GET/PUT /api/settings`, `GET/PUT /api/schedule`).

A first verification pass covered only single small jobs and reported
"pause/resume state transitions work" — that claim was wrong: pause was
never actually exercised mid-flight (the test file finished downloading
before pause landed). A second pass, prompted by an advisor review that
flagged this gap explicitly, built a local test HTTP server
(range-capable slow drip, a non-range host, and a connection that drops
mid-response) and found **four more real bugs**, all in code paths a
single small job never touches:

6. **Chunk retry restarted from the wrong offset.** In
   `DownloadEngine.downloadChunk`, `startByte` was computed once before
   the retry loop while `chunk.downloaded` kept accumulating inside it —
   a retry after a dropped connection re-requested from the original
   offset while progress-so-far kept counting the failed attempt,
   inflating `chunk.downloaded` past the chunk's real size. On a later
   pause this made the completeness check think the chunk had finished
   when it hadn't, leaving a zero-filled hole in a file `finalizeJob`
   would still hash and mark `completed`. Fixed by recomputing the offset
   from `chunk.downloaded` on every retry attempt, and by resetting
   `chunk.downloaded` (with a negative correction to the live progress
   counter) at the start of a retry on non-range hosts, since those can't
   resume a partial response and would otherwise write the restarted
   stream at the wrong file offset. **Verified** against a server that
   deliberately truncates the connection for chunk 0's first real request
   — the retry completed and the file's sha256 matched the source exactly.
7. **Known-size files on non-range hosts were routed to ffmpeg instead of
   the byte-range downloader.** `startJob` branched on `sizeBytes &&
   supportsRange`; a host that reports a size but not `Accept-Ranges`
   fell to the ffmpeg manifest path, which fails on anything that isn't
   an actual media container. Fixed to branch on `sizeBytes` alone —
   `downloadChunk`'s non-range handling (previously dead code, since
   nothing routed to it) already does the right thing: no `Range` header,
   sequential writes, single chunk. **Verified**: a fixture server with a
   known `Content-Length` and no `Accept-Ranges` header now downloads
   correctly with a matching sha256, where it previously errored out via
   ffmpeg.
8. **`pause()` never freed the concurrency slot.** Neither did the
   aborted branch of `startJob`'s catch block. With `maxConcurrentJobs`
   lower than the number of jobs in flight, pausing an active job left a
   queued job stalled indefinitely. Fixed by calling `tryStartNext()` in
   both places. **Verified**: with `maxConcurrentJobs: 1`, pausing the
   active job now reliably starts the next queued one immediately.
9. **`pause()` had no state guard**, found while testing #8: calling it
   on an already-completed job unconditionally overwrote `state` to
   `"paused"`, leaving a nonsensical record (paused, but `completedAt`
   and `sha256` still set). Fixed to no-op outside `active`/`queued`,
   matching `resume()`'s existing guard.
10. **A race between pause/remove and the still-unwinding aborted
    download**, also found while testing #8: `pause()` mutates a fresh
    `jobStore.get()` snapshot, but the aborting download's `onProgress`/
    `onChunkPersist` callbacks hold a *different* in-memory job object
    and can still fire once (already in flight when `abort()` was
    called) after pause() has written "paused" to the DB — silently
    reverting it back to `"active"`. The same race would let `remove()`
    "resurrect" a job row it had just deleted. Fixed by checking
    `signal.aborted` at the top of both callbacks (safe due to JS's
    single-threaded execution model: no callback can be mid-execution
    when `abort()` runs, so the check is race-free). **Verified**: paused
    a job, re-checked its state twice more over the following 4 seconds
    (long enough for multiple would-be stale ticks) — stayed `paused`
    throughout, no clobber. **Known remaining tradeoff**: because the
    final post-abort `onChunkPersist` is now also skipped, a paused job's
    persisted chunk progress can lag up to ~2s behind actual bytes
    written (the periodic persist interval) — on resume this means
    re-downloading a small amount of already-fetched data, not
    corruption. Fixing that fully would mean sharing one live job/runtime
    object between the download loop and pause/resume/remove instead of
    two independently-upserting copies — not done here, tracked as a
    possible follow-up if the redundant-bytes cost ever matters.
11. **WebSocket feed was completely unverified** in the first pass
    despite live progress being a stated requirement and the Flutter
    client's only update mechanism. **Verified**: connected a raw `ws`
    client, created a job, confirmed `job:added` → repeated `job:update`
    (live `downloadedBytes`/`speedBytesPerSec` changing) → `job:removed`
    all arrive in the exact `{type, jobId, payload}` envelope `docs/API.md`
    specifies.
12. **A manifest/ffmpeg job's progress callback wrote a 0-100 percentage
    into `downloadedBytes`**, a field the contract defines as a byte
    count — would have rendered as e.g. "42 B" in any UI formatting it as
    bytes. Fixed to leave it at 0 for the duration of that job type
    rather than repurposing the field (no byte-accurate progress is
    available from ffmpeg's manifest piping anyway).

A third pass — another advisor review of the second pass's diff — found
**four more issues**, none touched by the fixture-server tests above
because every one of them lives outside the "single job, no throttle, no
Docker, always-present output file" envelope those tests stayed inside:

13. **`SpeedThrottle.consume()` undercharged large reads, silently
    exceeding low caps.** It charged `min(bytes, capacityBytesPerSec)`
    tokens regardless of how many bytes were actually about to be
    written — a 64KB read against a 10KB/s cap was charged only 10KB
    worth of tokens, letting real throughput run ~6x over the configured
    limit. The `min()` was there to dodge a real deadlock (`refill()`
    caps `tokens` at `capacityBytesPerSec`, so requiring more than that
    per call could never be satisfied), but discarding the excess was
    the wrong fix. Corrected to pay the *full* amount across as many
    refill cycles as it takes. This path had zero runtime coverage
    before this pass — every earlier test ran with
    `globalBandwidthCap: null` and no per-job throttle set. **Verified**:
    throttled a 5MB fixture-server download to 200KB/s (with
    `maxConcurrentJobs: 0` as a gate so the cap was in effect from the
    first byte, not raced against by an instant loopback transfer) —
    took 25s against an expected ~24.4s, and the completed file's sha256
    matched the source exactly.
14. **`applyPostProcess`'s temp file lived in `config.tmpDir`, but the
    final rename target is in `config.downloadsDir`.** Natively both
    happen to be on the same filesystem (both under `backend/`), so this
    never showed up locally — but `docker-compose.yml` mounts them as
    two separate named volumes, and `fs.rename()` across a filesystem
    boundary throws `EXDEV`. Every extract-audio/transcode/remux job —
    i.e. the MP3-conversion feature the whole sniffer pipeline exists
    for — would fail under the Docker deployment path in README.md.
    Fixed by writing the temp file next to the final output instead of
    in a separate temp directory; the "ffmpeg won't use one path as both
    input and output" problem this temp file solves only ever needed a
    distinct *filename*, never a distinct directory. Not re-verified
    under an actual `docker compose up --build` (still not run, see
    below) — verified by re-running the extract-audio-to-MP3 test
    natively to confirm the rename-adjacent-file logic still works.
15. **Resuming trusted persisted chunk offsets without checking that the
    file they describe still exists / is still the right size.** Same
    defect class as bug 6 above: `DownloadEngine.runJob` unconditionally
    recreates and truncates the output file, so if `downloads/` was
    cleared (or a crash landed between the DB write and the file being
    created) while a job was paused, resuming would fetch only the
    *remaining* range starting from the stale `chunk.downloaded` offset
    into what is now a freshly zero-filled file — leaving the skipped
    prefix as zeros, and the completeness assert added for bug 6
    wouldn't catch it (each chunk's byte *count* still looks right, the
    content underneath just isn't there). Fixed: before trusting
    persisted `chunkState`, `runByteRangeJob` now stats the output file
    and discards the plan (replanning fresh) if it's missing or its size
    doesn't match `job.sizeBytes`. **Verified** on a second attempt after
    the first was interrupted by an environment reset mid-session (which
    killed all background test processes and cleared `/tmp` — the
    interruption did incidentally verify a *different* previously-untested
    path for free: restarting the backend correctly recovered the one job
    left `active` in the DB from the killed process back to `paused`, the
    `QueueManager` constructor's startup-recovery logic, also previously
    never exercised). On retry: paused a 40MB fixture-server download at
    ~10% (3.9MB), deleted the output file from `downloads/` entirely,
    resumed — the job correctly restarted from scratch rather than
    resuming into the gap, and the completed file's sha256 matched the
    source exactly.
16. **Two `if (job.sizeBytes)` truthiness checks** (job-type routing in
    `startJob`, chunk-count/chunk-plan setup in `createJob`) would
    misroute a legitimate 0-byte file. Changed to `!== null`, matching
    the check that was already correct elsewhere (`supportsRange:
    probe.supportsRange && probe.sizeBytes !== null`). Cheap, not
    independently tested (0-byte files are an extreme edge case) but
    mechanical enough to trust by inspection.

A fourth pass, on the diff from the third, found one more real bug —
again in code with zero prior runtime coverage:

17. **`Scheduler.tick()` applied a rule's bandwidth cap but never
    released it.** It returned early whenever no rule matched the
    current time, leaving `globalBandwidthCap` permanently stuck at
    whatever the last matching rule set it to. The class's own docstring
    example ("throttle to 500KB/s during business hours") would throttle
    permanently after hours too — the code, the docstring, and
    `docs/API.md`'s "leaves globalBandwidthCap untouched" description of
    the no-match case couldn't all be true at once. Fixed: `Scheduler`
    now remembers whatever cap was in effect immediately before a rule
    first started overriding it (`baselineCap`), and restores exactly
    that value the moment no rule matches anymore, rather than assuming
    "no match" means "leave as-is" or "reset to unlimited." **Verified**:
    set a manual cap (999999), applied an always-on rule with a different
    cap (123456) via `PUT /api/schedule` and confirmed `GET /api/settings`
    reflected it immediately (`setRules()` calls `tick()` synchronously),
    then cleared the rule set and confirmed the cap reverted to the
    original manual value (999999) rather than staying at 123456 or
    resetting to `null`. **Known limitations, not fixed** (same family, both cheap to hit but
    neither worth the code given this is an optional feature): if the
    user changes the cap via `PUT /api/settings` *while* a rule is
    actively overriding it, that manual change is not what gets restored
    when the rule's window ends — the pre-override baseline is, and
    correct behavior here is genuinely ambiguous (override-this-too, or
    wait-for-the-window-to-end?). Separately, `baselineCap` is in-memory
    only: if the backend restarts mid-window, the rule's already-applied
    cap becomes the new "baseline" on restart and won't be released when
    the window ends.

Also cleaned up in this pass: `config.tmpDir` (`TMP_DIR` env var, the
`tmp` Docker volume) was dead code left over from before fix 14 above --
its only consumer now writes its temp file next to the final output
instead. Removed from `config/index.ts`, `.env.example`, `.env`, and
`docker-compose.yml` rather than leaving a temp-directory strategy that
no longer exists implied for the next reader.

All of the above (all four passes) are fixed, typechecked, and — except
where noted above — re-verified against fixture servers post-fix. Both
`backend` (port 8787) and `sniffer-service` (port 8788) are left running
on this box for continuity — check with `curl 127.0.0.1:8787/api/health` /
`:8788/health` before assuming they're down. (Playwright *is* now
installed — see the next section, which supersedes the "not Playwright"
note this line used to have.)

## Real-world site compatibility (follow-up session, same day)

The scaffolding session above validated the pipeline mechanically (a
fixture server, synthetic files). This session pointed it at the three
sites the user actually wants — YouTube, Dailymotion, Anghami — via the
real browser extension for the first time, and fixed what broke. Two are
now genuinely working; one is a deliberate no per the DRM scope line.

**YouTube — fixed, verified.** Was failing with "Sign in to confirm
you're not a bot." Root cause turned out to be three separate missing
pieces, each surfacing only once the previous one was fixed:

1. **No authenticated session.** Fixed with `--cookies-from-browser
   chrome` (yt-dlp reads the live Chrome cookie jar). Needed
   `secretstorage` installed for Linux/GNOME-keyring cookie decryption to
   fully succeed rather than silently partially failing.
2. **No PO (proof-of-origin) token**, once cookies got past the bot-check
   ("The page needs to be reloaded" was this, not a cookie problem).
   Fixed by installing the `bgutil-ytdlp-pot-provider` pip package (the
   yt-dlp-side client) *and* running its server half:
   `docker run -d --name bgutil-pot --restart no -p 127.0.0.1:4416:4416
   brainicism/bgutil-ytdlp-pot-provider:latest`. This container is
   **not part of `docker compose up`** for the native deployment this box
   runs — it's a standalone dependency, started once, that yt-dlp finds
   at its default `127.0.0.1:4416`. (It *is* wired into
   `docker-compose.yml` as a `bgutil-pot` service for the containerized
   deployment path — untested like the rest of that path, see below.)
3. **No JS runtime new enough to solve YouTube's "n-parameter" challenge**
   (formats resolved to storyboards-only without this). yt-dlp requires
   Node.js ≥ 22; this box's system Node (apt/nodesource) was v20, and
   upgrading it needs sudo this session doesn't have. Fixed by downloading
   a portable Node 22 into `sniffer-service/.local-node/` and pointing
   yt-dlp at it via `--js-runtimes node:<path>`. Also needed the
   `yt-dlp-ejs` pip package (the actual challenge-solver script bundle —
   without it every JS runtime shows as "unavailable" regardless of
   version).

All three are now automated: `sniffer-service/setup.sh` downloads the
portable Node when needed and prints the `docker run` command for the PO
token server; `app/config.py` (`YTDLP_COOKIES_FROM_BROWSER`,
`YTDLP_NODE_PATH`, `YTDLP_POT_SERVER_BASE_URL`) auto-detects the portable
Node if `setup.sh` was run and wires all three into every yt-dlp
invocation via `ytdlp_wrapper.py`'s `_extra_args()`. **Verified**
end-to-end through the actual `/api/sniff` → `/api/sniff/grab` → download
pipeline (not just raw yt-dlp CLI): grabbed a real ~35-minute episode at
144p, ffprobe confirmed a valid, complete, correct-duration h264/aac mp4.

Also fixed along the way: `_format_to_stream` was classifying YouTube's
storyboard formats (scrubbing-preview thumbnail grids, `format_note ==
"storyboard"`) as audio-only streams, since storyboards share `vcodec ==
"none"` with real audio formats. Now filtered out before classification.

**Known constraint, not fixed**: `--cookies-from-browser` fundamentally
requires a real browser profile on the same machine — this is why it's
disabled (`YTDLP_COOKIES_FROM_BROWSER: ""`) in `docker-compose.yml`'s
`sniffer-service` environment. **YouTube extraction will not work in the
Docker deployment path** without a different cookie-provisioning strategy
(e.g. mounting an exported `cookies.txt` and switching `ytdlp_wrapper.py`
to `--cookies <file>` instead) — not implemented, since the Docker path
itself remains unbuilt/unverified (see below) and this box's actual
deployment is native.

**Dailymotion — fixed, verified.** Was failing with "The extractor is
attempting impersonation, but none of these impersonate targets are
available: firefox" — Dailymotion's extractor requires TLS-fingerprint
impersonation via `curl_cffi`, which wasn't installed. Installing it
naively pulled `curl_cffi` 0.16.0, which is *newer* than this yt-dlp
version supports (`yt_dlp/networking/_curlcffi.py` hard-fails on import
outside "0.5.10 or 0.10.x–0.15.x") — pinned to `0.13.0` instead, which is
now in `requirements.txt` with a comment pointing at that exact file for
whoever bumps yt-dlp later and hits the same failure again. **Verified**
via `/api/sniff`: real title, 4 real HLS streams up to 1080p.

**Anghami — investigated twice, confirmed out of scope with hard evidence
the second time, not a bug.** yt-dlp has no Anghami extractor, so this
falls to the Playwright network-sniffing fallback.

*First pass* (logged-out): clicking Anghami's "Play" button immediately
redirected to Google/Facebook/Apple OAuth login flows rather than playing
anything — Anghami requires an authenticated session to play *any*
content, even previews. Speculated (but didn't confirm) that real tracks
are also DRM-protected like Spotify/Apple Music, and stopped there.

*Second pass* (user came back with a screenshot of themselves actually
logged in and playing a song, asking why sniffing still failed): this
surfaced a real, general gap worth fixing regardless of Anghami's outcome
— `network_interceptor.py` always launched a fresh, cookie-less Playwright
context, so it could never see a real login even when the user has one in
their own browser. Fixed properly, mirroring the same fix already used
for `ytdlp_wrapper.py`/YouTube: `_extract_cookies_for_domain()` reuses
yt-dlp's own cookie-extraction code (`yt_dlp.cookies`, config knob
`NETWORK_SNIFF_COOKIES_FROM_BROWSER`, default `"chrome"`) to inject the
user's real session cookies into the sniffing browser context before
navigating. Also added `_try_trigger_playback()`, a generic (not
Anghami-specific) best-effort click-a-play-button + call-`.play()`-on-any-
media-element heuristic, since many sites don't request audio until
playback is actually triggered by interaction.

**Found two real bugs while building this, both fixed and verified**:
1. `context.add_cookies()` rejected the whole batch outright if *any*
   cookie's `expires` was invalid — yt-dlp's extraction occasionally
   returns `expires` still in Chrome's internal epoch (microseconds since
   1601-01-01) rather than converted Unix seconds, e.g. `13465644362561492`
   for one Anghami cookie, which would place that cookie's expiry around
   the 15th century as a literal timestamp. Fixed with a sane upper bound
   (year 2100) rather than just checking positivity; anything outside that
   range gets its `expires` omitted entirely (falls back to session-cookie
   behavior, harmless for a sniff that only lives a few seconds anyway).
2. `wait_until="networkidle"` intermittently timed out entirely on
   Anghami specifically (a site with persistent background
   polling/analytics connections that may never let the network go fully
   idle) — not fixed in the shipped code since it self-recovered on retry
   and wasn't the actual blocker, but worth knowing if `sniff_network`
   ever needs to get more robust: `domcontentloaded` + an explicit sleep
   is the more reliable pattern for sites like this.

With cookies genuinely working (`playqueue/fetch`, `liked-albums`,
`GETuserrelations` all fired — unambiguous proof of an authenticated
session, and the sniffed page title exactly matched the user's own
screenshot) and the *correct* single "Play" button confirmed clicked
(verified via `get_by_text(exact=True)`, one visible match, right
`outerHTML`), **still no audio stream appeared** in ~20 captured
responses around the click. What did appear:
`disableCaptcha=false` as an explicit parameter on Anghami's own
stream-authorization request, alongside live Google reCAPTCHA calls
(`recaptcha/api2/reload`, `/bcn`) firing in the same window. **This is
concrete evidence of active bot-detection gating the play path**, not
speculation — Anghami runs reCAPTCHA specifically here, and defeating
that would mean solving/bypassing a CAPTCHA to get past a service's
deliberate anti-automation protection. That is a different, harder line
than "sniff what's normally observable on a page" and was not attempted,
on the same principle as the DRM scope line: this tool doesn't defeat
deliberate protections, regardless of target. Confirms (with hard
evidence this time, not just a DRM guess) that Anghami stays out of
scope. **No further Anghami-specific work should be attempted** — the
wall here isn't a bug to fix, it's Anghami's product working as designed
against exactly this kind of access.

The cookie-injection and playback-trigger improvements themselves are
kept and shipped — genuinely useful for other login-walled-but-not-
actively-bot-protected sites that fall to this fallback, verified not to
break the no-cookies/no-media common case (`example.com` still correctly
returns "no media found" with no errors).

**Playwright is now actually installed** (`sniffer-service/setup.sh` was
run for real this session, not just written) — `pip install playwright`
+ `playwright install chromium` both completed, and
`network_interceptor.py` is confirmed working (used live for the Anghami
investigation above). This supersedes the original scaffolding session's
"Playwright: written, not installed" status. `sniffer-service/.venv` on
this box now has the full dependency set from the updated
`requirements.txt` (curl_cffi, yt-dlp-ejs, bgutil-ytdlp-pot-provider,
secretstorage, playwright) — a fresh `setup.sh` run elsewhere will
reproduce the venv but still needs the two manual steps `setup.sh` prints
at the end (start the PO token container; confirm the named browser is
installed and logged in).

## Deployment-address configurability + dev scripts (same follow-up session)

The user asked where to find this / how to install on Ubuntu, Windows,
and mobile. Answer given: the backend already runs natively here (this
*is* their Ubuntu machine); Windows needs either a native install or
Docker; mobile can only ever run the Flutter client as a thin client
against a backend running somewhere reachable, which is a real decision
(see below), not a checklist item. User's actual ask for *now*: keep
testing on localhost, but make the backend address adjustable via
config/env so it doesn't need code changes later when they do deploy
somewhere.

- **Extension**: `background/api.js`'s `BACKEND_BASE` was a hardcoded
  constant — changed to read `backendBaseUrl` from `chrome.storage.local`
  (default: the local dev backend), with a new options page
  (`extension/options/`, wired via `manifest.json`'s `options_ui`) to set
  it, plus a gear-icon shortcut to that page from the popup. No manifest
  permission changes needed — `host_permissions` already had broad
  `http://*/*`/`https://*/*` for the sniffing feature, which already
  covers whatever address gets configured here.
- **Flutter client**: added `lib/services/connection_prefs.dart`
  (persists a `host:port` via `shared_preferences`, separate from
  `SettingsStore` since this is a local device preference needed *before*
  any backend call can be made, not something fetched from one) and a
  "Connection" section at the top of `SettingsScreen`. `main.dart` loads
  the persisted host before building the provider tree; changing it
  requires an app restart to take effect (documented in the save
  confirmation) rather than tearing down/rebuilding every provider
  mid-session.
- **`scripts/start-dev.sh` / `scripts/stop-dev.sh`**: one-command
  start/stop for backend + sniffer-service + the YouTube PO token
  container, idempotent (skips anything already running), logs to
  `.dev-logs/`. This directly replaces the manual multi-step
  start/stop/restart sequence used throughout both sessions above.
  **Verified**: ran both scripts for real (stop, then start, then start
  again to confirm the idempotency check), all three services came back
  healthy.
- **README.md**: added a "Pointing a client at a different backend"
  section spelling out where each client's setting lives, and an explicit
  warning that the backend's `127.0.0.1`-only binding is the *only*
  current protection against unauthenticated access — going beyond
  localhost (LAN or public internet) needs an auth layer that does not
  exist yet. This was said plainly to the user rather than implied: it's
  the actual blocker for "put it online," not a config value away.

**Not done, and deliberately not started**: no authentication was added
to the backend. The user's stated plan is "test on localhost now, decide
on Windows/mobile/online later" — building auth now would be scope
creep against that stated sequencing. Whoever picks up the "online"
step next should treat adding auth as the prerequisite, not an
afterthought alongside it.

## What's scaffolded but not runtime-verified

- **Playwright network-sniffing fallback**
  (`sniffer-service/app/network_interceptor.py`): written, not installed
  or run. Installing it means downloading a ~200MB Chromium binary —
  deliberately not done automatically. Run `sniffer-service/setup.sh`
  when you actually need to sniff a site yt-dlp doesn't support, then
  restart uvicorn. Until then, `/sniff` still works for every
  yt-dlp-supported site; unsupported sites get a clear warning instead of
  a crash.
- **Browser extension**: manifest JSON validated, every JS file
  syntax-checked, and manually reviewed for MV3-specific correctness
  (fixed two real bugs: `chrome.contextMenus.create` was being called
  unconditionally at module scope, which throws "duplicate id" every time
  the MV3 service worker wakes from idle — moved into
  `chrome.runtime.onInstalled`; and the per-tab detected-media map was a
  plain in-memory `Map`, which is wiped every time the service worker
  unloads — switched to `chrome.storage.session`). **Since superseded**:
  loaded in the user's real Chrome and used against a real YouTube page
  (see "Real-world site compatibility" above) — the extension code itself
  worked correctly on first real-browser load; every bug that session
  found was in the sniffer-service's yt-dlp invocation, not the
  extension.
- **Flutter client** (`client/lib/`): **since superseded** — see "Native
  app builds" above. Was hand-written against `docs/API.md` and never
  compiled as of this note; has since been through `flutter analyze`
  (zero real errors) and built into working, installed, running apps for
  both Ubuntu and Android.
- **Docker**: `docker-compose.yml` and both Dockerfiles were written and
  `docker compose config` was used to confirm the YAML parses and
  resolves correctly. The images were **not built** — the sniffer-service
  image pulls Microsoft's Playwright base image, another heavy download
  skipped for the same reason as above. `docker compose up --build` is
  untested.

## Design decisions worth knowing before extending this

- **API contract lives in `docs/API.md`, not in any one codebase.** Job
  state enum, port numbers, the `StreamDescriptor`/`SniffResult` shape,
  and the WebSocket envelope are all frozen there first and implemented
  identically in TS/Python/Dart/JS. Update it first if you're changing
  any shared shape.
- **DRM is a hard scope line, not a TODO**: `network_interceptor.py`
  actively greps manifest bodies for SAMPLE-AES/ContentProtection/DRM
  markers and skips+warns rather than fetching them; yt-dlp formats with
  `has_drm` are filtered the same way. Don't add CDM/license-request
  handling.
- **Bandwidth cap is per-job with a global ceiling, not one shared
  token bucket.** `QueueManager.effectiveLimit` = `min(job's own
  throttle, global cap)`, each job gets its own `SpeedThrottle` instance.
  This means N unthrottled jobs can still collectively exceed a "global"
  cap meant to represent total link capacity — documented tradeoff, not
  a bug, but worth fixing with an actual shared bucket if precise total
  bandwidth control ever matters.
- **Schedule rules** (`ScheduleRule`, `/api/schedule`) are additive
  automation on top of the manual `globalBandwidthCap` setting: with zero
  rules configured, `PUT /api/settings` behaves exactly as if the
  scheduler didn't exist. Evaluated every 60s server-side.
- **Manifest-based streams (HLS/DASH) skip the byte-range downloader
  entirely** and go straight through `ffmpeg -i <manifest> -c copy` (see
  `QueueManager.runManifestOrStreamJob` / `FFmpegProcessor.muxFromManifest`).
  ffmpeg handles segment fetch/concat itself; there's no hand-rolled HLS
  segment logic in this codebase, deliberately.

## Suggested next steps, in order

1. ~~Load the extension in a real browser~~ — done, this is what surfaced
   the YouTube/Dailymotion/Anghami work above. The browser-extension code
   itself hasn't needed a single change since that first real-world test,
   only the sniffer-service's yt-dlp invocation did.
2. ~~`flutter create . && flutter pub get && flutter analyze`~~ — done,
   zero real errors. ~~Build and install the Ubuntu/Android apps~~ — also
   done, see "Native app builds" above; both are real, tested, installable
   artifacts in `client/dist/`, not just successful compiler runs.
3. ~~Windows build~~ — done via GitHub Actions CI, see "Native app
   builds" above. Repo: `https://github.com/johns196/downloadmnager`
   (public). Re-run any time via `workflow_dispatch` on the Actions tab,
   or just push a `client/**` change.
4. **APK is unsigned** (release-mode build, but no distribution signing
   key) — fine for installing directly on a personal device via `adb
   install` or sideloading, but would need a proper Android signing setup
   before any wider distribution (Play Store or otherwise). Same question
   worth asking for the Windows build eventually (unsigned .exe will
   trigger SmartScreen warnings on first run).
5. **iOS currently only compile-checks in CI, produces nothing
   installable** — deliberate, user chose this scope explicitly (see
   "iOS" above). If real device distribution is wanted later: user needs
   an Apple Developer Program membership ($99/year) or their own Mac +
   free Apple ID for a 7-day self-signed build, then the `build-ios` CI
   job needs real signing (certificate + provisioning profile as GitHub
   Actions secrets, `flutter build ipa` instead of `--no-codesign`) —
   not started, needs the user's account/cost decision first.
6. Set up a git credential helper (or install `gh` CLI and `gh auth
   login`) so future pushes don't need a token pasted into a command each
   time — this session used a personal access token passed transiently on
   the CLI (never persisted to `.git/config`), which works but isn't
   sustainable for ongoing work.
7. If the PO token container (`bgutil-pot`) or portable Node
   (`.local-node/`) are ever missing on a fresh checkout of this box,
   re-run `sniffer-service/setup.sh` and follow the two manual steps it
   prints — see "Real-world site compatibility" above for the full
   why. `docker ps` / `curl 127.0.0.1:4416/ping` confirm the PO container
   specifically.
8. Decide whether the global-bandwidth-cap tradeoff above needs a real
   shared token bucket, or whether per-job-cap-with-ceiling is good
   enough for how this is actually going to be used.
9. `docker compose up --build` once, to actually validate the
   Dockerfiles (and specifically the EXDEV fix noted above, which was
   fixed by inspection but never run inside an actual container) rather
   than just the compose YAML. Remember YouTube won't work there without
   solving the cookies-in-a-container problem noted above first.
