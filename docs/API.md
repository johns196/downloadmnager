# API Contract — Universal Download Manager

This is the single source of truth for every field name, enum value, and port
number used across `backend/`, `sniffer-service/`, `extension/`, and
`client/`. If you change something here, update all four. Drift between
these is the #1 way this scaffold stops wiring up.

## Ports (all bind to 127.0.0.1 only — never 0.0.0.0)

| Service         | Port | Protocol         |
|------------------|------|------------------|
| backend          | 8787 | HTTP + WebSocket |
| sniffer-service   | 8788 | HTTP             |

Backend is the only service the extension and Flutter client ever talk to.
The sniffer-service is internal — backend proxies sniff requests to it.

## Job state enum

Canonical list, spelled identically in TS (`backend/src/core/types.ts`),
Python (`sniffer-service/app/models.py` uses a subset), Dart
(`client/lib/models/download_job.dart`), and the extension's plain JS:

```
queued | active | paused | completed | error | canceled
```

- `queued` — created, waiting for a free download slot.
- `active` — chunks currently being fetched.
- `paused` — user-paused or throttled to 0; resumable from saved chunk state.
- `completed` — all chunks merged, integrity hash verified.
- `error` — unrecoverable failure after retries exhausted; `error` field on
  the job carries the message.
- `canceled` — user-removed before completion; partial files deleted.

Transitions: `queued → active → (paused ↔ active) → completed`, and any
non-terminal state can move to `error` or `canceled`.

## Job object (the shape returned by every job-bearing endpoint and pushed
over the WebSocket)

```ts
interface DownloadJob {
  id: string;                // uuid v4
  url: string;
  filename: string;
  outputPath: string;        // absolute path under backend/downloads
  state: JobState;
  sizeBytes: number | null;  // null until first response headers arrive
  downloadedBytes: number;
  speedBytesPerSec: number;  // rolling average, 0 when paused/queued
  etaSeconds: number | null;
  chunks: number;            // number of parallel byte-range workers used
  createdAt: string;         // ISO 8601
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  sha256: string | null;     // populated once integrity check completes
  source: "manual" | "extension" | "sniffer";
  mediaKind: "file" | "audio" | "video";
  postProcess: PostProcessSpec | null; // set when the job came from a sniff
  downloadKind: "byte-range" | "manifest" | "ytdlp-merge"; // which QueueManager execution path -- internal, clients don't need to branch on it
}

interface PostProcessSpec {
  action: "remux" | "transcode" | "extract-audio";
  targetContainer: "mp3" | "flac" | "mp4" | "mkv" | "m4a" | null;
  tags: { title?: string; artist?: string; album?: string; artworkUrl?: string } | null;
}
```

## REST endpoints (backend, base `http://127.0.0.1:8787/api`)

| Method | Path                     | Body                                   | Notes |
|--------|--------------------------|-----------------------------------------|-------|
| GET    | `/jobs`                  | —                                       | list all jobs, newest first |
| GET    | `/jobs/:id`               | —                                       | single job |
| POST   | `/jobs`                   | `{ url, filename?, chunks?, mediaKind?, source?, postProcess? }` | enqueue a direct download. `source` defaults to `"manual"`; pass `"extension"` from the browser extension |
| POST   | `/jobs/:id/pause`         | —                                       | |
| POST   | `/jobs/:id/resume`        | —                                       | |
| DELETE | `/jobs/:id`                | `?deleteFile=true\|false`               | cancel/remove |
| POST   | `/jobs/:id/throttle`      | `{ bytesPerSec: number \| null }`      | null = unlimited |
| GET    | `/settings`               | —                                       | global concurrency/bandwidth caps |
| PUT    | `/settings`               | `{ maxConcurrentJobs, maxChunksPerJob, globalBandwidthCap }` | |
| POST   | `/sniff`                  | `{ url }`                               | proxies to sniffer-service, returns `SniffResult` |
| POST   | `/sniff/grab`             | `{ url, streamId, postProcess? }`       | turns one sniffed stream into a job |
| GET    | `/schedule`               | —                                       | list automated bandwidth-schedule rules |
| PUT    | `/schedule`               | `ScheduleRule[]`                        | replace the full rule set |

### `ScheduleRule` (optional automated queue rules)

```ts
interface ScheduleRule {
  id: string;
  label: string;
  enabled: boolean;
  startHour: number;   // 0-23 local time
  endHour: number;     // 0-23, exclusive, wraps past midnight
  daysOfWeek: number[]; // 0=Sun..6=Sat, [] = every day
  bandwidthCapBytesPerSec: number | null;
}
```

Evaluated every 60s server-side; first matching enabled rule wins and its
cap is pushed into `globalBandwidthCap` (including to already-running
jobs). No rules configured = purely manual `PUT /settings` behavior.

## `SniffResult` (backend ⇄ sniffer-service ⇄ extension)

```ts
interface StreamDescriptor {
  id: string;                 // stable within one sniff result
  url: string;                // manifest or direct media URL
  protocol: "hls" | "dash" | "direct" | "progressive";
  container: string | null;   // "mp4", "m4a", "webm", etc, null if unknown
  codec: string | null;
  bitrateKbps: number | null;
  resolution: string | null;  // "1920x1080" for video, null for audio-only
  durationSeconds: number | null;
  isAudioOnly: boolean;
  hasAudio: boolean;          // false = silent video-only stream (common on YouTube above ~360p); distinct from isAudioOnly, which only means "no video track"
  title: string | null;
  thumbnailUrl: string | null;
  extractor: "yt-dlp" | "yt-dlp-merge" | "network-sniff"; // which path found it
}

interface SniffResult {
  pageUrl: string;
  pageTitle: string | null;
  streams: StreamDescriptor[];
  warnings: string[]; // e.g. "DRM-protected stream skipped"
}
```

Sniffer-service internal endpoint: `POST http://127.0.0.1:8788/sniff` with
`{ "url": string }`, returns `SniffResult`. Backend does not modify the
shape, it only wraps/proxies.

### "yt-dlp-merge" streams (best-quality video with audio)

Modern YouTube (and often other yt-dlp-supported sites) serve
high-quality video as a *silent* video-only DASH stream, separate from an
audio-only one -- true "video+audio in one file" formats are usually
capped at a low resolution (360p on YouTube). `ytdlp_wrapper.extract()`
detects this (at least one `hasAudio: false` video stream and at least
one `isAudioOnly: true` stream) and prepends one synthetic
`StreamDescriptor` with `extractor: "yt-dlp-merge"`:

- `url` is the **page** URL, not a fetchable stream -- this entry can't
  be downloaded like any other `StreamDescriptor`.
- `container` is always `"mp4"`, `isAudioOnly` is `false`, `hasAudio` is
  `true`.

`POST /sniff/grab` special-cases `extractor === "yt-dlp-merge"`: instead
of the normal single-URL downloader, it calls the sniffer-service's
`POST http://127.0.0.1:8788/download-merged` with
`{ url: pageUrl, outputPath: <absolute path> }`, which runs `yt-dlp -f
"bv*+ba/b" --merge-output-format mp4` itself and writes the finished,
muxed file **directly to `outputPath` on the shared filesystem** --
deliberately not returned as an HTTP response body, since this service
and the backend always run on the same machine (the same
native-deployment assumption `--cookies-from-browser` already requires).
Returns `{ ok: boolean, error: string | null }`. No byte-accurate
progress is reported during this call; the job's `downloadedBytes` stays
0 until it completes and the real file size is read.

**Caching**: the backend caches each `SniffResult` per page URL for 5
minutes (`backend/src/core/sniffer/SnifferClient.ts`) so that a
`StreamDescriptor.id` returned by `POST /sniff` stays resolvable by a
later `POST /sniff/grab` -- ids are generated fresh on every raw call to
the sniffer-service, so without this cache `grab` could never find the id
the client already has. One consequence: on sites that hand out
short-lived signed media URLs, a `grab` more than a few minutes after the
original `sniff` may fail with an expired-URL error from the origin
server -- re-sniff in that case rather than reusing an old id.

## WebSocket (`ws://127.0.0.1:8787/ws`)

Single connection, server pushes an envelope per event:

```ts
interface WsEvent {
  type: "job:update" | "job:added" | "job:removed" | "job:log";
  jobId: string;
  payload: DownloadJob | { message: string };
}
```

Clients (Flutter, extension popup) do not send anything but an optional
`{"type":"subscribe"}` ping on connect — the server broadcasts all events to
all connected clients regardless, since this is a single-user local tool.

## Extension → backend

The extension only ever calls the REST API above, from the background
service worker, with `host_permissions` scoped to `http://127.0.0.1:8787/*`.
It never talks to the sniffer-service directly.

## Scope line (see README for full rationale)

- No DRM (Widevine/PlayReady/FairPlay) handling anywhere in this codebase.
  `sniffer-service` must actively skip encrypted HLS/DASH renditions and
  report them in `SniffResult.warnings`, not attempt to fetch keys.
