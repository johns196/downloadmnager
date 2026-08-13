import Database from "better-sqlite3";
import { config } from "../config/index.js";
import type { DownloadJob, GlobalSettings, JobRuntimeState, ScheduleRule } from "../core/types.js";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    output_path TEXT NOT NULL,
    state TEXT NOT NULL,
    size_bytes INTEGER,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    speed_bytes_per_sec REAL NOT NULL DEFAULT 0,
    eta_seconds INTEGER,
    chunks INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    error TEXT,
    sha256 TEXT,
    source TEXT NOT NULL,
    media_kind TEXT NOT NULL,
    post_process TEXT,
    chunk_state TEXT NOT NULL DEFAULT '[]',
    throttle_bytes_per_sec INTEGER,
    supports_range INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS: GlobalSettings = {
  maxConcurrentJobs: config.maxConcurrentJobs,
  maxChunksPerJob: config.maxChunksPerJob,
  globalBandwidthCap: null,
};

interface JobRow {
  id: string;
  url: string;
  filename: string;
  output_path: string;
  state: string;
  size_bytes: number | null;
  downloaded_bytes: number;
  speed_bytes_per_sec: number;
  eta_seconds: number | null;
  chunks: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error: string | null;
  sha256: string | null;
  source: string;
  media_kind: string;
  post_process: string | null;
  chunk_state: string;
  throttle_bytes_per_sec: number | null;
  supports_range: number;
}

function rowToJob(row: JobRow): DownloadJob {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    outputPath: row.output_path,
    state: row.state as DownloadJob["state"],
    sizeBytes: row.size_bytes,
    downloadedBytes: row.downloaded_bytes,
    speedBytesPerSec: row.speed_bytes_per_sec,
    etaSeconds: row.eta_seconds,
    chunks: row.chunks,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    error: row.error,
    sha256: row.sha256,
    source: row.source as DownloadJob["source"],
    mediaKind: row.media_kind as DownloadJob["mediaKind"],
    postProcess: row.post_process ? JSON.parse(row.post_process) : null,
  };
}

function rowToRuntime(row: JobRow): JobRuntimeState {
  return {
    chunkState: JSON.parse(row.chunk_state),
    throttleBytesPerSec: row.throttle_bytes_per_sec,
    supportsRange: !!row.supports_range,
  };
}

const upsertStmt = db.prepare(`
  INSERT INTO jobs (
    id, url, filename, output_path, state, size_bytes, downloaded_bytes,
    speed_bytes_per_sec, eta_seconds, chunks, created_at, updated_at,
    completed_at, error, sha256, source, media_kind, post_process,
    chunk_state, throttle_bytes_per_sec, supports_range
  ) VALUES (
    @id, @url, @filename, @output_path, @state, @size_bytes, @downloaded_bytes,
    @speed_bytes_per_sec, @eta_seconds, @chunks, @created_at, @updated_at,
    @completed_at, @error, @sha256, @source, @media_kind, @post_process,
    @chunk_state, @throttle_bytes_per_sec, @supports_range
  )
  ON CONFLICT(id) DO UPDATE SET
    filename=excluded.filename, output_path=excluded.output_path,
    state=excluded.state, size_bytes=excluded.size_bytes,
    downloaded_bytes=excluded.downloaded_bytes,
    speed_bytes_per_sec=excluded.speed_bytes_per_sec,
    eta_seconds=excluded.eta_seconds, updated_at=excluded.updated_at,
    completed_at=excluded.completed_at, error=excluded.error,
    sha256=excluded.sha256, post_process=excluded.post_process,
    chunk_state=excluded.chunk_state,
    throttle_bytes_per_sec=excluded.throttle_bytes_per_sec,
    supports_range=excluded.supports_range
`);

export const jobStore = {
  upsert(job: DownloadJob, runtime: JobRuntimeState): void {
    upsertStmt.run({
      id: job.id,
      url: job.url,
      filename: job.filename,
      output_path: job.outputPath,
      state: job.state,
      size_bytes: job.sizeBytes,
      downloaded_bytes: job.downloadedBytes,
      speed_bytes_per_sec: job.speedBytesPerSec,
      eta_seconds: job.etaSeconds,
      chunks: job.chunks,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      completed_at: job.completedAt,
      error: job.error,
      sha256: job.sha256,
      source: job.source,
      media_kind: job.mediaKind,
      post_process: job.postProcess ? JSON.stringify(job.postProcess) : null,
      chunk_state: JSON.stringify(runtime.chunkState),
      throttle_bytes_per_sec: runtime.throttleBytesPerSec,
      supports_range: runtime.supportsRange ? 1 : 0,
    });
  },

  get(id: string): { job: DownloadJob; runtime: JobRuntimeState } | undefined {
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    if (!row) return undefined;
    return { job: rowToJob(row), runtime: rowToRuntime(row) };
  },

  list(): DownloadJob[] {
    const rows = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[];
    return rows.map(rowToJob);
  },

  /** Jobs left mid-flight from a previous process (used on startup to
   * flip them to `paused` rather than silently pretending they're active). */
  listActiveOrQueued(): { job: DownloadJob; runtime: JobRuntimeState }[] {
    const rows = db
      .prepare("SELECT * FROM jobs WHERE state IN ('active','queued')")
      .all() as JobRow[];
    return rows.map((row) => ({ job: rowToJob(row), runtime: rowToRuntime(row) }));
  },

  remove(id: string): void {
    db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  },
};

export const settingsStore = {
  get(): GlobalSettings {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'global'").get() as
      | { value: string }
      | undefined;
    if (!row) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  },

  set(settings: GlobalSettings): void {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('global', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify(settings));
  },
};

export const scheduleStore = {
  list(): ScheduleRule[] {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'scheduleRules'").get() as
      | { value: string }
      | undefined;
    return row ? (JSON.parse(row.value) as ScheduleRule[]) : [];
  },

  replaceAll(rules: ScheduleRule[]): void {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('scheduleRules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify(rules));
  },
};

export default db;
