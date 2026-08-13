// Canonical types for this backend. Mirrors docs/API.md exactly --
// if you change a field here, update API.md and the Python/Dart/JS
// equivalents (sniffer-service/app/models.py,
// client/lib/models/download_job.dart, extension/background/api.js).

export const JOB_STATES = [
  "queued",
  "active",
  "paused",
  "completed",
  "error",
  "canceled",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export type MediaKind = "file" | "audio" | "video";
export type JobSource = "manual" | "extension" | "sniffer";

export type PostProcessAction = "remux" | "transcode" | "extract-audio";
export type TargetContainer = "mp3" | "flac" | "mp4" | "mkv" | "m4a";

export interface PostProcessTags {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}

export interface PostProcessSpec {
  action: PostProcessAction;
  targetContainer: TargetContainer | null;
  tags: PostProcessTags | null;
}

/** One byte-range worker's progress within a job. Persisted so pause/resume
 * and best-effort resume-after-restart both work off the same record. */
export interface ChunkState {
  index: number;
  start: number; // absolute byte offset in the target file, inclusive
  end: number; // absolute byte offset, inclusive
  downloaded: number; // bytes written so far for this chunk
  done: boolean;
}

export interface DownloadJob {
  id: string;
  url: string;
  filename: string;
  outputPath: string;
  state: JobState;
  sizeBytes: number | null;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  chunks: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  sha256: string | null;
  source: JobSource;
  mediaKind: MediaKind;
  postProcess: PostProcessSpec | null;
}

/** Extra runtime-only state kept alongside a job but not sent to clients
 * verbatim as part of DownloadJob (chunkState is persisted for resume but
 * is an implementation detail, not part of the public API surface). */
export interface JobRuntimeState {
  chunkState: ChunkState[];
  throttleBytesPerSec: number | null;
  supportsRange: boolean;
}

export interface StreamDescriptor {
  id: string;
  url: string;
  protocol: "hls" | "dash" | "direct" | "progressive";
  container: string | null;
  codec: string | null;
  bitrateKbps: number | null;
  resolution: string | null;
  durationSeconds: number | null;
  isAudioOnly: boolean;
  title: string | null;
  thumbnailUrl: string | null;
  extractor: "yt-dlp" | "network-sniff";
}

export interface SniffResult {
  pageUrl: string;
  pageTitle: string | null;
  streams: StreamDescriptor[];
  warnings: string[];
}

export type WsEventType = "job:update" | "job:added" | "job:removed" | "job:log";

export interface WsEvent {
  type: WsEventType;
  jobId: string;
  payload: DownloadJob | { message: string };
}

export interface GlobalSettings {
  maxConcurrentJobs: number;
  maxChunksPerJob: number;
  globalBandwidthCap: number | null; // bytes/sec, null = unlimited
}

/** Optional automated queue rule: while the current local hour falls in
 * [startHour, endHour), cap global bandwidth to `bandwidthCapBytesPerSec`
 * (null = unlimited during that window). Empty `daysOfWeek` = every day.
 * Rules are evaluated in array order; the first match wins. When no rule
 * matches, the schedule leaves `globalBandwidthCap` untouched. */
export interface ScheduleRule {
  id: string;
  label: string;
  enabled: boolean;
  startHour: number; // 0-23, local time
  endHour: number; // 0-23, exclusive; supports wraparound (e.g. 22 -> 6)
  daysOfWeek: number[]; // 0=Sunday .. 6=Saturday, [] = every day
  bandwidthCapBytesPerSec: number | null;
}
