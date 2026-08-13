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

## Firefox compatibility (extension)

User asked whether the sniffer/extension works in Firefox too — it had
only ever been targeted at Chrome/Chromium. Checked with Mozilla's own
official validator (`web-ext lint`, via `npx web-ext@latest`) rather than
guessing, since MV3-on-Firefox has real, specific differences from
MV3-on-Chrome:

1. **`background.service_worker` alone doesn't work on Firefox** — Firefox
   MV3 background scripts run as an Event Page, not a true Service
   Worker, and are declared via `background.scripts` (an array), not
   `background.service_worker`. Fixed by declaring both keys in the same
   `background` object (the standard cross-browser pattern): Chrome reads
   `service_worker` and ignores `scripts`, Firefox reads `scripts` and
   ignores `service_worker` (logs a harmless informational warning about
   it, confirmed via lint — not an error).
2. **`browser_specific_settings.gecko.id` is required** in Manifest V3 —
   Chrome auto-generates an extension ID, Firefox requires one declared
   explicitly. Added
   `download-manager-grabber@globymall-tech.local`.
3. **`data_collection_permissions` is required** (a newer Firefox privacy
   requirement) — declared `{"required": ["none"]}` since this extension
   collects/sends nothing except to the user's own localhost backend.
   This key needs Firefox ≥140 (desktop) / ≥142 (Android) to even be
   recognized, so `strict_min_version` was set to `142.0` to cover both
   and avoid a version-mismatch warning.

After these three fixes, `web-ext lint` reports **zero errors**, one
purely-informational warning (Chrome's `service_worker` key being
correctly ignored on Firefox, exactly as intended by declaring both keys).

**Now verified live**, by the user, in their own real Firefox session
(deliberately not driven remotely by this agent — see above for why). Two
Firefox-specific problems surfaced that `web-ext lint` couldn't catch,
since neither is a manifest defect:

1. **"Unable to load script: moz-extension://.../content/content-script.js"
   when loading via `about:debugging` → Load Temporary Add-on → pick
   `manifest.json`.** Root cause: this machine's Firefox is a **snap**.
   Snap-sandboxed apps' file-picker dialogs always go through the
   `xdg-desktop-portal` document broker — the portal hands the sandbox
   access to *only the single file the user clicked*, presented as if it
   were alone in an empty directory, regardless of which real directory
   it lives in or what other filesystem permissions the snap has (moving
   the extension into `$HOME` did **not** help — this is inherent to the
   picker, not a path/permission issue). So Firefox can open
   `manifest.json` itself but can't resolve any sibling file it
   references. **Fix**: package the extension as a single `.zip`
   (`manifest.json` at the archive root, not nested in a subfolder) and
   pick that instead — one file for the portal to hand over, and Firefox
   unzips it internally, so no further sibling-file lookups happen.
   `scripts/sync-firefox-extension.sh` now does this: rebuilds
   `~/downloadmanager-extension.zip` from `extension/` on every run. Re-run
   it after any extension code change, then in Firefox: Remove the old
   temporary add-on → Load Temporary Add-on → pick that zip again.
2. **Background script shows "Stopped" after ~30s of inactivity in
   `about:debugging`.** Not a bug — MV3 background scripts are event
   pages in both Chrome and Firefox; they unload when idle to save memory
   and wake automatically on the next message/event (e.g. clicking the
   launcher). No fix needed, just surprised the user seeing it the first
   time.

Storage APIs (`chrome.storage.session`/`.local`) and everything else in
the extension code worked with zero changes once the zip-loading problem
above was solved — the earlier "one area of real uncertainty" note about
`chrome.*` vs `browser.*` promise style turned out to be a non-issue.

## Sniffer reliability fixes (follow-up session, same week)

Two real bugs surfaced from the user actually using the Firefox extension
against Anghami, both fixed and verified:

1. **`networkidle` timeout on sites with persistent background
   connections.** `network_interceptor.py`'s Playwright fallback used to
   `page.goto(..., wait_until="networkidle")`, which waits for zero
   network activity for 500ms. Anghami (and sites like it — polling,
   analytics beacons, websockets) never actually go network-idle, so this
   reliably timed out the whole sniff at `NETWORK_SNIFF_TIMEOUT_SECONDS`
   and surfaced as a raw "Page load did not fully settle: Timeout ...
   exceeded" error to the user. This had been *identified* in an earlier
   pass but explicitly left unfixed since it self-recovered on retry and
   wasn't the actual blocker at the time (see Anghami reCAPTCHA finding
   below) — fixed for real once the user hit it as a visible error.
   **Fix**: `wait_until="domcontentloaded"` (fires once, always) followed
   by an explicit `NETWORK_SNIFF_SETTLE_SECONDS` (4s) sleep before reading
   `page.title()` or attempting playback — SPAs commonly hydrate their
   real/localized title well after the initial DOM parse, so the title
   read was moved to after the settle delay too. Verified against both
   `play.anghami.com/song/1291297193` (15.78s, correct title, no timeout)
   and `example.com` (18.1s, correct title, no regression on the simple
   case).
2. **Re-clicking "Sniff" on the same page URL returned the previous
   track, not the one currently playing.** `SnifferClient.ts` caches
   `/sniff` results per page URL for 5 minutes — necessary because
   `StreamDescriptor.id` is regenerated by the sniffer-service on every
   call, and `/api/sniff/grab` needs a stable id to resolve against a
   result the user already saw. But that cache read was applied to
   *every* call to `sniffUrl()`, including the one from the explicit
   "Sniff" button click (`POST /api/sniff`) — so on an SPA where playing a
   different item doesn't change the page URL (Anghami: picking another
   track from "Recommended Songs" plays it in place via the persistent
   bottom player, no navigation), re-sniffing within the TTL window
   silently returned the old track's stream. **Fix**: `sniffUrl()` now
   takes an optional `{ forceFresh }`; `POST /api/sniff` (the user-facing
   action) always passes `forceFresh: true` and goes live, then refreshes
   the cache; `QueueManager.createJobFromSniff`'s internal id-resolution
   call (used only by grab, right after a sniff the user already saw)
   keeps the old cache-preferring behavior unchanged. Verified: two
   `POST /api/sniff` calls for the same URL back-to-back both took
   ~13-15s (a real sniff each time) instead of the second one returning
   near-instantly from cache as before.

Both fixes live entirely in the shared backend/sniffer-service, so they
apply to every client (extension, Ubuntu/Android/Windows/iOS app) without
any client-side changes — none of the four apps have their own caching or
page-load logic that could independently go stale.

## "Still getting the old track" — the real architectural fix (same week)

The two fixes above weren't actually the fix for this symptom, and the
user proved it: after both shipped, resniffing on Anghami *still* returned
a stale/unrelated track, and the request that proved it (`?noautoplay=1&
extras=...`) was a URL the backend had never cached, ruling caching out
entirely. Root cause, confirmed by directly inspecting a live `/api/sniff`
response: the network-sniff fallback (`network_interceptor.py`) loads the
page URL fresh in its **own throwaway headless Chromium instance** — it
has no connection whatsoever to the user's real, already-open, already-
logged-in tab. On a normal page that's fine. On an SPA like Anghami, where
picking another track from "Recommended Songs" plays it via the
persistent bottom player *without changing the page URL*, the headless
reload can only ever land on the URL's own canonical song — confirmed by
the sniff response's `pageTitle` still reading the original song's title
verbatim, with three unrelated stream URLs (different ISRC codes) that
matched neither the original track nor whatever the user was actually
playing. No amount of resniffing was ever going to fix this; it isn't a
staleness bug, it's a fundamentally different data source than "what's
playing in your tab right now."

**The real fix uses a mechanism that already existed but was wired to the
wrong UI.** `background/service-worker.js` has always passively watched
each tab's actual network traffic (`chrome.webRequest.onCompleted`,
filtered to media-looking responses) and stored what it finds per-tab in
`chrome.storage.session`. This runs in the real tab, so it reflects
whatever the user is truly playing right now, and — since it's only reset
on a full navigation (`chrome.tabs.onUpdated` "loading"), not an SPA
in-place track change — it keeps accumulating every track played in one
session. It was already exposed via a `GET_TAB_MEDIA` message and
rendered in `popup.js`'s "Detected on page" section, but the **floating
in-page panel** (`content-script.js`, the "↓" launcher the user actually
uses, confirmed live in an earlier round) had its own, separate "Detected
on page" implementation that only scanned the DOM for `<video>/<audio>`
elements' `src` — which is empty for any player using MediaSource
Extensions / a `blob:` URL, Anghami included (the code already explicitly
filters out `blob:` since it's not fetchable outside the page's own JS
context).

Verified this passive path actually sees Anghami's traffic before
building anything on top of it (asked the user to check the toolbar
icon's badge count while a track played — confirmed non-zero), since
building UI on an unverified assumption would just risk a third "still
didn't work." With that confirmed:

- `service-worker.js`'s `recordMedia()` now also pushes a
  `TAB_MEDIA_UPDATED` message straight to that tab's content script on
  every new detection (`.catch(() => {})` for tabs with nothing injected),
  not just the badge count — the floating panel is long-lived on the page
  (unlike a popup, which just re-reads on each open), so it needed a way
  to learn about new tracks without the user re-clicking anything.
- `content-script.js`'s panel now renders from that live-pushed/
  `GET_TAB_MEDIA`-seeded list instead of the local DOM scan. Switching
  tracks on Anghami now updates the panel automatically.
- **No reliable track name for these entries** — deliberately left as the
  filename off the URL, not a title. Checked first: Anghami's `pageTitle`
  (read via Playwright's `page.title()` in the sniff test above) stayed
  on the original song throughout, so `chrome.tabs.get(tabId).title` would
  almost certainly do the same for every entry here — a confidently wrong
  label is worse than an anonymous one, so it was left out rather than
  guessed at. Getting a real name would mean scraping Anghami's own
  now-playing DOM element, which is exactly the kind of site-specific
  special-casing this project has deliberately avoided everywhere else
  (see "What this is"). Not done without the user weighing in first.
- **MP3 conversion extended to this path too** (user asked for it
  explicitly). This needed real plumbing, not just a UI button:
  `POST /api/jobs` silently dropped any `postProcess` field from the
  request body even though `QueueManager.createJob` and the shared
  finalize-time apply-postProcess step already fully supported it (proven
  working previously via the separate `/api/sniff/grab` path) — just
  never wired through this route. Fixed in `jobs.ts`, `api.js`
  (`createJob` now takes a third `postProcess` arg), and
  `DOWNLOAD_DIRECT`'s handler in `service-worker.js`. Verified for real,
  not just by reading the code: created a job via `POST /api/jobs` with
  `postProcess: {action:"extract-audio", targetContainer:"mp3", tags:
  {title:"..."}}` against a real external mp3 URL, confirmed the finished
  file is genuinely re-encoded (`ffprobe` shows `codec_name=mp3`) with the
  requested ID3 title tag applied, not just silently passed through.
- Along the way, also fixed the *sniffed-stream* results (the "Streams
  found" section from the backend's own sniff, separate from this
  passively-detected section): the "Extract audio (MP3)" button was
  gated on `!stream.isAudioOnly`, hiding it precisely when a stream is
  already audio (e.g. Anghami's m4a) — backwards, since that's exactly
  when a user most wants to convert to mp3. `extractAudio()` in
  `FFmpegProcessor.ts` uses `-vn`, a safe no-op when there's no video
  track, so this was just a wrong gate, not a real limitation. Changed to
  gate on `stream.container !== "mp3"` in both `popup.js` and
  `content-script.js`, and both now also show the stream's title (fetched
  by the backend, previously never displayed).

**Two bugs caught in review before shipping, both would have reproduced
the exact symptom this feature exists to fix:**
1. `recordMedia` only clears its per-tab map on a full page navigation, so
   on an SPA it accumulates every track played this session in insertion
   order — rendering that order unreversed put the *first* track played
   at the top (the easiest entry to click), not the current one. Fixed by
   reversing before rendering in both `content-script.js` and `popup.js`,
   with the UI honest about the fact that Anghami specifically preloads a
   next-queued track alongside the current one (seen in the earlier sniff
   test's three distinct ISRCs), so it's framed as "last one or two" being
   current/next, not a guaranteed single answer.
2. The floating panel's empty-state returned before appending its hint
   text — meaning after the required extension+tab reload (which resets
   the newly-empty map), the panel would render as blank with no
   explanation, indistinguishable from the old broken version. Fixed to
   always render a status line, empty or not.

**Scope note**: this whole "know what's actually playing right now" fix
is browser-extension-only — it depends on `chrome.webRequest` watching a
real, live browser tab. The Flutter native apps have no equivalent
capability and never can (they don't run inside a browser), so this does
NOT extend to "all apps" the way the two fixes in the section above
legitimately did. Their sniffing is, and remains, the same URL-based
approach with the same "blind to in-page state" limitation.

## Naming and delete-from-Library (same week, immediate follow-up)

User feedback after the live-detection feature above landed: sniffing
itself finally worked, but (1) detected-item names were opaque CDN hashes
("naming is weird, should be like the one before") and (2) no way to
delete a completed download from the Library screen, specifically to
clear out duplicate files created while testing.

1. **Title capture for detected items.** `recordMedia()` in
   `service-worker.js` now calls `chrome.tabs.get(tabId)` fresh at the
   moment each item is recorded (not once at page load) and stores
   `tab.title` alongside the url/contentType. Deliberately not proven to
   be per-track accurate on Anghami specifically — the earlier sniff
   test's `pageTitle` only ever showed a static value, and that's still
   the only direct evidence available. Shipped anyway because the
   downside is bounded: worst case (title genuinely doesn't change per
   track) every entry shares one title, which is exactly the old
   single-title-per-sniff behavior the user asked to match — not a
   regression either way.
2. **Saved filenames now use the title too, with a mandatory uniqueness
   suffix.** Caught in review before shipping: if that title *is* static
   across tracks, naively using it as the filename would make different
   songs collide onto the same name, and `uniqueOutputPath()` would save
   them as indistinguishable "Song (1).m4a" / "Song (2).m4a" — strictly
   worse than the ugly-but-unique hash names, since at least those were
   traceable back to distinct URLs. Fixed by appending a short non-crypto
   hash of the source URL to every generated filename (`shortHash()` in
   both `content-script.js` and `popup.js`) — readable title, guaranteed
   unique regardless of what the title turns out to be.
3. **Delete button added to `LibraryScreen`** (`client/lib/screens/
   library_screen.dart`) — it never had one, only a play/open button,
   confirmed from the screenshot the user sent matching this screen
   exactly. Backend delete (`DELETE /api/jobs/:id?deleteFile=true`) and
   `DownloadStore.remove()` already existed and needed no changes; this
   was purely a missing UI affordance. Added with a confirmation dialog
   (irreversible, deletes the real file) and `deleteFile: true` by
   default — deliberately different from `DownloadCard`'s generic remove
   button (which keeps a completed file on disk), since Library entries
   are files the user is actively browsing and the motivating case was
   explicitly "let me delete the duplicate files," not just clear a list
   entry. `flutter analyze` clean; **not yet clicked by the user** — the
   rebuilt `.deb` needs installing first (`sudo dpkg -i client/dist/
   download-manager-client_0.1.0_amd64.deb`).
4. **Existing duplicate files in the Library don't rename themselves** —
   the new title-based naming only applies to downloads made after this
   change. The pre-existing "(1)" through "(5)" duplicates the user saw
   still have their old CDN-hash names; the new delete button is how to
   clear those, not a retroactive rename.

## Ambiguous titles on prefetched tracks (same week, immediate follow-up)

User pushed back correctly on the "audio + unrelated promo video" theory
from the round above with a *different* concrete example: two entries
under "Al Aad Al Aaksi - Marwan Khoury & Elissa", both clearly audio-shaped
filenames (`6650967771069_LBA132501377_MD5_...m4a` and
`ANGH1749299081692769.m4a`), not audio+video. Tried to settle it with a
disposable headless Playwright test (cookies injected, real "Play" button
clicked) rather than guess again or touch the user's live session — got
zero media requests both attempts, consistent with the already-documented
Anghami reCAPTCHA/bot-detection wall gating the stream-authorization path
in any non-live-session context. So no clean automated repro was possible
here; asked the user to check directly instead.

**They did, and found the real mechanism**: downloaded and listened to
both files. The first (`6650967771069...`) was the correct track. The
second (`ANGH1749...`) was actually a *different, next-queued* song,
mislabeled with the current track's title. Best explanation: Anghami
prefetches an upcoming queued track's audio before that track's own title
has taken over the tab, so `recordMedia`'s live `chrome.tabs.get(tabId)`
title read (added in the round above) catches it mid-transition and
stamps it with the wrong (current, not upcoming) title.

This is exactly the "confidently wrong is worse than no name" failure
mode flagged during design of the title-capture feature — now confirmed
with a real example instead of being theoretical. Fix: **when a title
repeats across two or more detected items, no attempt is made to guess
which one is correct** (no reliable signal for that — could just as
easily be a trailing request for the *previous* track completing right as
the title changes, not only a next-track prefetch; the user's one data
point doesn't establish a direction to trust). Instead every item sharing
that title gets flagged " (unconfirmed)" in both the displayed name and
the actual saved filename (`content-script.js` and `popup.js`, both the
render function and `filenameFor`), with a tooltip explaining why. The
uniqueness hash suffix from the round above already guarantees these
never collide into the same file; this just stops the label from
asserting something that turned out to be false in a real, user-verified
case.

## Best-guess ranking for ambiguous titles (same week, immediate follow-up)

User asked directly: is the ambiguous-title problem above actually
fixable, or is flagging both "(unconfirmed)" the ceiling? Re-examined the
one confirmed case with that question in mind: within the "Al Aad Al
Aaksi" group, the *wrong* file (`ANGH1749...`) was the earlier of the two
detections, and the *correct* one (`6650967771069...`) came right after,
under the same title. That ordering is consistent with the wrong one
being a trailing leftover from the previous track's transition settling
just as the title switches, rather than a next-track prefetch racing
ahead of it -- i.e. the *later* detection under a repeated title is the
more likely real, settled fetch for that title.

Only one real case confirms this direction, so it's used as a ranking
signal, not a filter: for any title shared by 2+ detected items, the most
recent one is now labeled "likely" (clean name, no scary flag -- it's the
expected-correct pick) and every earlier one under that same title is
labeled "uncertain -- try the newer entry instead", pointing the user at
the better guess directly instead of leaving two identically-flagged
options to gamble between. Both stay fully visible and downloadable --
this is a ranking, not a hide -- since the one-data-point signal isn't
strong enough to justify actually dropping anything. Applied to both the
displayed label and the saved filename (only the "uncertain" one gets a
suffix now; the "likely" pick keeps a clean name) in both `content-
script.js` and `popup.js`.

**Bug caught before shipping**: the first implementation compared items by
object identity (`sameTitle[...] !== item`) to determine "is this the
latest". That breaks as soon as `TAB_MEDIA_UPDATED` replaces
`detectedMedia` wholesale between when the panel renders and when the
user actually clicks a button (a real timing window, given this list
updates live) -- the click handler's closure still holds the *old* item
object, which would never reference-match anything in the *new* array,
silently misclassifying every item as uncertain. Fixed to compare by
`.url` instead, which survives the array being replaced.

## Best-guess ranking reverted -- direction didn't generalize

The "later detection is more likely correct" ranking above lasted one
round. User tested a new same-titled pair and got the opposite result
from the one that motivated the ranking in the first place: this time the
earlier detection was the correct file, not the later one. Two data
points pointing in opposite directions means there was never a real
signal, just one coincidental case being over-read as a pattern.

Reverted `content-script.js` and `popup.js` back to the flat
"(unconfirmed)" labeling from the round before (both members of a
repeated-title group flagged equally, no favored pick) via `git checkout
885bbd7 -- ...` rather than hand-reconstructing it, to guarantee an exact
revert. The uniqueness hash suffix and everything else from that round is
unaffected. No further attempt at ranking same-titled entries without a
genuinely reliable signal (e.g. actual duration/content probing) -- that
would need real engineering investment (fetching and inspecting each
candidate, not just reading a timestamp), not another guess from a single
example. Flagging both and letting the user check the downloaded file
(as they've done successfully twice now) is the honest ceiling here.

## Correction: the "opposite result" was a misreading, not a new data point

The revert above turns out to have been based on a misunderstanding, not
genuine conflicting evidence. When the user said "the first one is good,
not the one later," they meant it exactly the same way as their original
report ("first one is the right one, the second one is fetching the next
song") -- **first/second in fetch order**, i.e. the earliest detection
under a title is correct and anything detected under that same title
afterward ("starts after some time") is the next-track prefetch. That is
one consistent finding stated twice, not two conflicting ones.

The actual error was in how the ranking round above (`Best-guess ranking
for ambiguous titles`) read the *first* report: it interpreted the
confirmed-correct file as the *chronologically later* detection (based on
its position in the newest-first-rendered UI list) and built the "later
one is likely correct" heuristic on that basis -- backwards. So when the
user repeated the same finding using time-based language ("starts after
some time"), it read as a second, contradicting case and got reverted
instead of corrected. The "two data points pointing in opposite
directions" conclusion in the revert section above is wrong; there was
only ever one direction, described consistently both times.

**Real fix, now implemented**: `recordMedia()` in `service-worker.js`
drops any item whose title matches one already recorded for that tab --
the first detection under a title wins, later ones sharing that title are
discarded outright rather than kept and flagged. This replaces both the
flat "(unconfirmed)" labeling and the reverted ranking; there is no
ambiguity left to label since duplicates never make it into the list.
Removed the now-dead ambiguous/ranking logic from `content-script.js` and
`popup.js` entirely rather than leaving it unreachable.

**Update**: the title-only version of this filter created a new bug --
reported by the user and fixed same-day, see "Dedup scoped to (title,
kind)" below. The tradeoffs as now shipped:
- A non-SPA page with one static, never-changing title but several
  distinct embedded items of the *same* kind (e.g. two different videos,
  no title change between them) will only ever surface the *first* one of
  that kind -- everything else of that kind under the same unchanging
  title gets dropped. One video + one audio under the same static title
  both still get through (different kinds). This wasn't a problem for
  Anghami/YouTube/Dailymotion (titles change per item), but if a future
  site shows fewer detected items than expected, check whether its title
  is actually changing per media item before assuming something broke.

## Dedup scoped to (title, kind), not title alone

Same-day follow-up: the title-only dedup above (first item under a title
wins, later ones dropped) had a real gap the user hit -- if the unrelated
promo video (`AnghamiPlusFeatures-NEW-NoAdsENG.mp4`) happened to load
*before* the actual track's audio under the same title, it permanently
claimed that title slot and the real song's audio was silently dropped,
never shown at all. Title-only dedup can't tell "this is a duplicate of
the same thing" apart from "this is a different thing that happens to
share a title right now" -- exactly the promo-video case.

Fix: `mediaKindOf(url, contentType)` in `service-worker.js` classifies
each item as `audio`/`video`/`other` (content-type first, URL extension
as fallback for CDNs that misreport it), and the dedup key in
`recordMedia()` is now `(title, kind)` instead of `title` alone. A video
loading under a title no longer blocks audio under that same title, or
vice versa -- the original prefetch bug is still caught, since both the
real track and the prefetched next-track's audio share the "audio" kind.

**Open question, not yet resolved**: the promo video itself still shows
up as its own entry now (unblocked, same as before this whole
investigation started) -- reintroducing the original "why 2 entries per
song" question, just with the real audio now actually present alongside
it instead of missing. Asked the user whether to filter
`AnghamiPlusFeatures`-style promo clips out entirely (site-specific, so
not done without asking) or leave them visible.

## Cross-platform parity check (same week, immediate follow-up)

User asked directly: did all of today's fixes make it to all four
platforms (Windows/Ubuntu/iOS/Android), not just the browser extension?
Worth answering carefully rather than assuming, since this project has
three genuinely different distribution mechanisms layered together:

- Backend + sniffer-service fixes (networkidle timeout, stale sniff
  cache, postProcess-through-jobs) are shared infrastructure every client
  hits through the same API -- these needed no porting, all four Flutter
  builds and the extension already go through them.
- The "know what's currently playing" live-detection feature is
  inherently extension-only (`chrome.webRequest` on a real browser tab) --
  correctly out of scope for the native apps, already noted as such.
- The Flutter **client source** (`client/lib/`) is one Dart codebase
  compiled four ways -- a source fix there needs porting once, but each
  platform's *installable artifact* still needs an actual rebuild to
  contain it.

Checked `sniffer_screen.dart` (the Flutter client's manual-sniff screen,
the equivalent of the extension's popup) against today's extension fixes
and found the **exact same bug**: `if (!stream.isAudioOnly)` hiding
"Extract audio (MP3)" precisely when a stream is already audio (Anghami's
m4a case). Never caught before because nobody had exercised MP3
conversion from this screen specifically. Fixed identically to the
extension (gate on `stream.container != "mp3"`). Confirmed no other
source-level gaps: `library_screen.dart`'s delete button (added earlier
this session) is the only other Flutter-specific change and was already
in place; the title-display the extension needed to add was already
present in `sniffer_screen.dart` from before.

**Artifact rebuild, not just source fix**: confirmed via the GitHub API
that CI (`build-client.yml`) auto-triggers on every `client/**` push and
had already rebuilt all four platforms once today (for the delete-button
commit, `057a37d`) -- but pushing the `sniffer_screen.dart` fix
(`618b6cf`) was still needed to get *that* fix built anywhere. Rebuilt
the Android APK locally too (`JAVA_HOME` needed pointing at
`.toolchain/jdk-17` -- not set by default in this shell), matching the
existing local Ubuntu `.deb` rebuild pattern.

**Found and fixed a distribution gap unrelated to the code itself**: the
CI workflow only uploads expiring, login-gated workflow-run artifacts --
it has no step that touches the permanent public GitHub Release (that was
a one-time manual `gh`-less API publish from an earlier session). So the
Release's public download links were serving **stale binaries with none
of today's fixes** even after CI succeeded. Not a workflow bug to fix
generally (would need a `softprops/action-gh-release`-style step added
deliberately, not done here since it changes what every future push does
without being asked) -- but for *today's* fixes specifically, downloaded
the four fresh CI artifacts, repackaged the Windows one into the same
flat-zip shape as the existing release asset, deleted the four stale
release assets, and uploaded the fresh ones in their place via the
GitHub API. Verified afterward: all four assets' `updated_at` now matches
this session, sizes changed (confirming real rebuilds, not no-ops).

**Bottom line**: as of this round, all four platform builds behind
`github.com/johns196/downloadmnager/releases/tag/v0.1.0` contain every
fix from this entire session, not just the extension.

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
