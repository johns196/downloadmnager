import path from "node:path";
import fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "../../config/index.js";
import { jobStore, settingsStore } from "../../db/database.js";
import { downloadEvents } from "../../events.js";
import { probeUrl } from "../downloader/probeUrl.js";
import { planChunks, runJob } from "../downloader/DownloadEngine.js";
import { SpeedThrottle } from "../downloader/SpeedThrottle.js";
import { sha256File } from "../integrity/HashVerifier.js";
import * as ffmpeg from "../media/FFmpegProcessor.js";
import { applyTags } from "../media/MetadataTagger.js";
import { sniffUrl } from "../sniffer/SnifferClient.js";
import { Scheduler } from "./Scheduler.js";
import type {
  ChunkState,
  DownloadJob,
  GlobalSettings,
  JobRuntimeState,
  JobSource,
  MediaKind,
  PostProcessSpec,
  TargetContainer,
} from "../types.js";

interface RunningHandle {
  controller: AbortController;
  throttle: SpeedThrottle;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueOutputPath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 1;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

export class QueueManager {
  private running = new Map<string, RunningHandle>();

  constructor() {
    // Anything left "active"/"queued" from a previous process has no
    // running workers behind it anymore -- surface that honestly as
    // `paused` instead of pretending it's still downloading.
    for (const { job, runtime } of jobStore.listActiveOrQueued()) {
      job.state = "paused";
      job.speedBytesPerSec = 0;
      job.updatedAt = nowIso();
      jobStore.upsert(job, runtime);
    }
  }

  getSettings(): GlobalSettings {
    return settingsStore.get();
  }

  updateSettings(patch: Partial<GlobalSettings>): GlobalSettings {
    const merged = { ...settingsStore.get(), ...patch };
    settingsStore.set(merged);
    this.tryStartNext();
    return merged;
  }

  listJobs(): DownloadJob[] {
    return jobStore.list();
  }

  getJob(id: string): DownloadJob | undefined {
    return jobStore.get(id)?.job;
  }

  async createJob(params: {
    url: string;
    filename?: string;
    chunks?: number;
    mediaKind?: MediaKind;
    source?: JobSource;
    postProcess?: PostProcessSpec | null;
  }): Promise<DownloadJob> {
    const probe = await probeUrl(params.url);
    const filename = params.filename?.trim() || probe.suggestedFilename;
    const outputPath = uniqueOutputPath(config.downloadsDir, filename);
    const settings = settingsStore.get();
    const requestedChunks = params.chunks ?? config.defaultChunksPerJob;
    const chunkCount =
      probe.supportsRange && probe.sizeBytes !== null
        ? Math.max(1, Math.min(requestedChunks, settings.maxChunksPerJob))
        : 1;

    const job: DownloadJob = {
      id: randomUUID(),
      url: params.url,
      filename: path.basename(outputPath),
      outputPath,
      state: "queued",
      sizeBytes: probe.sizeBytes,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      chunks: chunkCount,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      error: null,
      sha256: null,
      source: params.source ?? "manual",
      mediaKind: params.mediaKind ?? "file",
      postProcess: params.postProcess ?? null,
    };

    const runtime: JobRuntimeState = {
      chunkState:
        probe.sizeBytes !== null ? planChunks(probe.sizeBytes, chunkCount) : [],
      throttleBytesPerSec: null,
      supportsRange: probe.supportsRange && probe.sizeBytes !== null,
    };

    jobStore.upsert(job, runtime);
    downloadEvents.emitWsEvent({ type: "job:added", jobId: job.id, payload: job });
    this.tryStartNext();
    return job;
  }

  async createJobFromSniff(pageUrl: string, streamId: string, postProcess?: PostProcessSpec | null) {
    const result = await sniffUrl(pageUrl);
    const stream = result.streams.find((s) => s.id === streamId);
    if (!stream) throw new Error(`Stream "${streamId}" not found in sniff result for ${pageUrl}`);

    const mediaKind: MediaKind = stream.isAudioOnly ? "audio" : "video";
    // Deliberately the *source* container, not postProcess.targetContainer:
    // this is the filename the raw download is written to. applyPostProcess
    // (called after the download completes) derives its own output path by
    // swapping this extension for the target one -- if the two ever match,
    // ffmpeg is asked to convert a file into itself and refuses. See
    // finalizeJob/applyPostProcess below.
    const inferredExt =
      stream.protocol === "hls" || stream.protocol === "dash" ? "mp4" : (stream.container ?? "mp4");
    const baseTitle = stream.title ?? result.pageTitle ?? "media";
    const filename = `${sanitizeFilename(baseTitle)}.${inferredExt}`;

    if (stream.protocol === "hls" || stream.protocol === "dash") {
      // Manifest-based streams are handed to ffmpeg directly rather than
      // the byte-range downloader -- segment fetch/concat is ffmpeg's job.
      return this.createManifestJob(stream.url, filename, mediaKind, postProcess ?? null);
    }

    return this.createJob({
      url: stream.url,
      filename,
      mediaKind,
      source: "sniffer",
      postProcess: postProcess ?? null,
    });
  }

  private async createManifestJob(
    manifestUrl: string,
    filename: string,
    mediaKind: MediaKind,
    postProcess: PostProcessSpec | null,
  ): Promise<DownloadJob> {
    const outputPath = uniqueOutputPath(config.downloadsDir, filename);
    const job: DownloadJob = {
      id: randomUUID(),
      url: manifestUrl,
      filename: path.basename(outputPath),
      outputPath,
      state: "queued",
      sizeBytes: null,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      chunks: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      error: null,
      sha256: null,
      source: "sniffer",
      mediaKind,
      postProcess,
    };
    const runtime: JobRuntimeState = { chunkState: [], throttleBytesPerSec: null, supportsRange: false };
    jobStore.upsert(job, runtime);
    downloadEvents.emitWsEvent({ type: "job:added", jobId: job.id, payload: job });
    this.tryStartNext();
    return job;
  }

  pause(id: string): DownloadJob {
    const record = jobStore.get(id);
    if (!record) throw new Error(`Job ${id} not found`);
    if (record.job.state !== "active" && record.job.state !== "queued") {
      // No-op on a terminal state: unconditionally overwriting state here
      // would flip an already-completed/errored/canceled job "back" to
      // paused, leaving a nonsensical record (paused, but with
      // completedAt/sha256 still set from when it actually finished).
      return record.job;
    }
    this.running.get(id)?.controller.abort();
    this.running.delete(id);
    record.job.state = "paused";
    record.job.speedBytesPerSec = 0;
    record.job.updatedAt = nowIso();
    jobStore.upsert(record.job, record.runtime);
    downloadEvents.emitWsEvent({ type: "job:update", jobId: id, payload: record.job });
    // Pausing an active job frees a concurrency slot -- without this, a
    // queued job just sits there until something else happens to call
    // tryStartNext() (e.g. another job finishing), which may be never if
    // the user paused specifically to let something else run.
    this.tryStartNext();
    return record.job;
  }

  resume(id: string): DownloadJob {
    const record = jobStore.get(id);
    if (!record) throw new Error(`Job ${id} not found`);
    if (record.job.state !== "paused" && record.job.state !== "error") {
      return record.job;
    }
    record.job.state = "queued";
    record.job.error = null;
    record.job.updatedAt = nowIso();
    jobStore.upsert(record.job, record.runtime);
    downloadEvents.emitWsEvent({ type: "job:update", jobId: id, payload: record.job });
    this.tryStartNext();
    return record.job;
  }

  async remove(id: string, deleteFile: boolean): Promise<void> {
    const record = jobStore.get(id);
    if (!record) return;
    this.running.get(id)?.controller.abort();
    this.running.delete(id);
    if (deleteFile) {
      await fsp.rm(record.job.outputPath, { force: true });
    }
    jobStore.remove(id);
    downloadEvents.emitWsEvent({ type: "job:removed", jobId: id, payload: record.job });
    this.tryStartNext();
  }

  setThrottle(id: string, bytesPerSec: number | null): DownloadJob {
    const record = jobStore.get(id);
    if (!record) throw new Error(`Job ${id} not found`);
    record.runtime.throttleBytesPerSec = bytesPerSec;
    jobStore.upsert(record.job, record.runtime);
    this.running.get(id)?.throttle.setLimit(this.effectiveLimit(bytesPerSec));
    return record.job;
  }

  /** Used by Scheduler to push a time-of-day bandwidth cap to every job
   * currently running, not just ones that start after the change. */
  applyGlobalBandwidthCap(bytesPerSec: number | null): void {
    const merged = { ...settingsStore.get(), globalBandwidthCap: bytesPerSec };
    settingsStore.set(merged);
    for (const [id, handle] of this.running) {
      const record = jobStore.get(id);
      handle.throttle.setLimit(this.effectiveLimit(record?.runtime.throttleBytesPerSec ?? null));
    }
  }

  private effectiveLimit(jobLimit: number | null): number | null {
    const global = settingsStore.get().globalBandwidthCap;
    if (jobLimit === null) return global;
    if (global === null) return jobLimit;
    return Math.min(jobLimit, global);
  }

  private tryStartNext(): void {
    const settings = settingsStore.get();
    if (this.running.size >= settings.maxConcurrentJobs) return;
    const next = jobStore.list().filter((j) => j.state === "queued");
    for (const job of next) {
      if (this.running.size >= settings.maxConcurrentJobs) break;
      void this.startJob(job.id);
    }
  }

  private async startJob(id: string): Promise<void> {
    const record = jobStore.get(id);
    if (!record || record.job.state !== "queued") return;

    const { job, runtime } = record;
    const controller = new AbortController();
    const throttle = new SpeedThrottle(this.effectiveLimit(runtime.throttleBytesPerSec));
    this.running.set(id, { controller, throttle });

    job.state = "active";
    job.updatedAt = nowIso();
    jobStore.upsert(job, runtime);
    downloadEvents.emitWsEvent({ type: "job:update", jobId: id, payload: job });

    try {
      // Branches on "do we know a size" alone, not size *and* range
      // support: a known-size file on a server that just doesn't
      // advertise Accept-Ranges still goes through the byte-range
      // downloader (as a single non-range chunk covering the whole
      // file -- see downloadChunk's !supportsRange handling), because
      // ffmpeg's manifest path assumes a streamable media
      // container/URL and errors out on arbitrary files. Only a truly
      // unknown size (sizeBytes === null -- always true for HLS/DASH
      // manifest jobs, see createManifestJob) falls to ffmpeg.
      if (job.sizeBytes !== null) {
        await this.runByteRangeJob(job, runtime, controller.signal, throttle);
      } else {
        await this.runManifestOrStreamJob(job, controller.signal);
      }

      await this.finalizeJob(job, runtime, controller.signal);
    } catch (err) {
      this.running.delete(id);
      if (controller.signal.aborted) {
        // Paused or canceled elsewhere -- that code path already persisted
        // the right terminal/paused state, so don't overwrite it here.
        // It also already called tryStartNext() itself (pause()/remove()),
        // but call it again anyway: it's idempotent, and this is the one
        // place that reliably fires no matter what triggered the abort.
        this.tryStartNext();
        return;
      }
      job.state = "error";
      job.error = (err as Error).message;
      job.updatedAt = nowIso();
      jobStore.upsert(job, runtime);
      downloadEvents.emitWsEvent({ type: "job:update", jobId: id, payload: job });
      downloadEvents.emitWsEvent({
        type: "job:log",
        jobId: id,
        payload: { message: `Job failed: ${job.error}` },
      });
      this.tryStartNext();
      return;
    }

    this.running.delete(id);
    this.tryStartNext();
  }

  private async runByteRangeJob(
    job: DownloadJob,
    runtime: JobRuntimeState,
    signal: AbortSignal,
    throttle: SpeedThrottle,
  ): Promise<void> {
    if (runtime.chunkState.length > 0 && !(await this.outputFileMatchesJob(job))) {
      // Persisted chunk offsets describe a file that's missing or the
      // wrong size (downloads/ was cleaned out, or a crash landed between
      // the DB write and the file actually being created/truncated).
      // DownloadEngine.runJob recreates and truncates the file
      // unconditionally, so trusting stale "chunk.downloaded" values here
      // would resume into what's actually a fresh, zero-filled file --
      // the exact silent-corruption shape already fixed once for the
      // retry-offset bug above. Discard the plan and start clean instead
      // of resuming into content that isn't there.
      runtime.chunkState = [];
    }
    if (runtime.chunkState.length === 0) {
      runtime.chunkState = planChunks(job.sizeBytes as number, job.chunks);
    }

    await runJob({
      url: job.url,
      outputPath: job.outputPath,
      sizeBytes: job.sizeBytes,
      supportsRange: runtime.supportsRange,
      chunks: runtime.chunkState,
      throttle,
      signal,
      onProgress: (downloadedBytes, speedBytesPerSec) => {
        // pause()/remove() abort this signal and then immediately write
        // their own authoritative state (paused, or a deleted DB row) to
        // a *different* in-memory job object than the one this closure
        // captured. Without this guard, a progress tick already in
        // flight when abort() fires would upsert *this* stale object
        // right after -- silently reverting "paused" back to "active",
        // or resurrecting a row remove() just deleted. Once aborted,
        // pause()/remove() own the record; this loop has nothing more to
        // say about it.
        if (signal.aborted) return;
        job.downloadedBytes = downloadedBytes;
        job.speedBytesPerSec = speedBytesPerSec;
        job.etaSeconds =
          job.sizeBytes && speedBytesPerSec > 0
            ? Math.round((job.sizeBytes - downloadedBytes) / speedBytesPerSec)
            : null;
        job.updatedAt = nowIso();
        jobStore.upsert(job, runtime);
        downloadEvents.emitWsEvent({ type: "job:update", jobId: job.id, payload: job });
      },
      onChunkPersist: (chunks: ChunkState[]) => {
        if (signal.aborted) return; // see onProgress above
        runtime.chunkState = chunks;
        jobStore.upsert(job, runtime);
      },
    });

    // Defense in depth against writing a corrupt-but-"completed" file:
    // the output file is truncate()'d to sizeBytes up front (see
    // DownloadEngine.runJob), so a wrong stat.size can never catch a
    // chunk that silently stopped short and left a zero-filled hole --
    // only checking each chunk's own byte count against its planned
    // range does. If this ever throws, it means either a real
    // downloader bug or a chunk aborted without going through the
    // normal pause/cancel path.
    const incomplete = runtime.chunkState.filter((c) => !c.done || c.downloaded !== c.end - c.start + 1);
    if (incomplete.length > 0) {
      throw new Error(
        `Download incomplete: ${incomplete.length}/${runtime.chunkState.length} chunk(s) did not finish for job ${job.id}`,
      );
    }
  }

  private async outputFileMatchesJob(job: DownloadJob): Promise<boolean> {
    try {
      const stat = await fsp.stat(job.outputPath);
      return stat.size === job.sizeBytes;
    } catch {
      return false; // missing entirely
    }
  }

  private async runManifestOrStreamJob(job: DownloadJob, signal: AbortSignal): Promise<void> {
    downloadEvents.emitWsEvent({
      type: "job:log",
      jobId: job.id,
      payload: { message: "No range support / unknown size -- using single-stream ffmpeg pipe" },
    });
    await ffmpeg.muxFromManifest(job.url, job.outputPath, {
      signal,
      onProgress: () => {
        // downloadedBytes is a byte count per docs/API.md, not a
        // percentage -- there's no byte-accurate progress for a
        // manifest/ffmpeg-piped job (ffmpeg only reports elapsed media
        // time vs. total duration, not bytes written), so this
        // deliberately leaves downloadedBytes at 0 for the duration
        // rather than repurposing the field with a 0-100 value that
        // would render as e.g. "42 B" of an unknown total in any UI
        // that formats it as bytes.
        if (signal.aborted) return; // see the matching guard in runByteRangeJob's onProgress
        job.updatedAt = nowIso();
        downloadEvents.emitWsEvent({ type: "job:update", jobId: job.id, payload: job });
      },
    });
  }

  private async finalizeJob(job: DownloadJob, runtime: JobRuntimeState, signal: AbortSignal): Promise<void> {
    if (job.postProcess) {
      await this.applyPostProcess(job, signal);
    }

    job.sha256 = await sha256File(job.outputPath, signal);
    const stat = await fsp.stat(job.outputPath);
    job.sizeBytes = stat.size;
    job.downloadedBytes = stat.size;
    job.state = "completed";
    job.completedAt = nowIso();
    job.updatedAt = job.completedAt;
    job.speedBytesPerSec = 0;
    job.etaSeconds = 0;
    jobStore.upsert(job, runtime);
    downloadEvents.emitWsEvent({ type: "job:update", jobId: job.id, payload: job });
  }

  private async applyPostProcess(job: DownloadJob, signal: AbortSignal): Promise<void> {
    const spec = job.postProcess;
    if (!spec) return;
    const container = spec.targetContainer;
    const finalPath = container
      ? job.outputPath.replace(/\.[^./]+$/, `.${container}`)
      : job.outputPath;

    // Always render to a throwaway temp path first, even when finalPath
    // would equal job.outputPath (same source/target container, e.g. a
    // same-container remux) -- ffmpeg refuses to use one path as both
    // input and output, so "process in place" has to go through a
    // distinct intermediate file regardless.
    //
    // That temp file deliberately lives next to finalPath (downloadsDir),
    // not in config.tmpDir: the rename below has to stay on one
    // filesystem. Natively downloadsDir and tmpDir happen to share a
    // filesystem so this wouldn't have shown up locally, but
    // docker-compose.yml mounts them as separate named volumes -- renaming
    // across them throws EXDEV. Distinguishing this from job.outputPath
    // only ever required a different *filename*, never a different
    // directory.
    const tempPath = path.join(path.dirname(finalPath), `.${job.id}${path.extname(finalPath)}`);

    if (spec.action !== "extract-audio" && spec.action !== "transcode" && spec.action !== "remux") {
      return; // nothing to do (e.g. action requires a container we don't have)
    }
    if ((spec.action === "extract-audio" || spec.action === "transcode") && !container) {
      return;
    }

    try {
      if (spec.action === "extract-audio") {
        await ffmpeg.extractAudio(job.outputPath, tempPath, container as TargetContainer, { signal });
      } else if (spec.action === "transcode") {
        await ffmpeg.transcode(job.outputPath, tempPath, container as TargetContainer, { signal });
      } else {
        await ffmpeg.remux(job.outputPath, tempPath, { signal });
      }
    } catch (err) {
      // ffmpeg failed, or the job was paused/canceled mid-encode -- clean
      // up the partial temp file rather than leaking it. This is exactly
      // how two 67MB orphaned `.{uuid}.mp3` files ended up sitting in
      // downloads/ during development: a job got interrupted here and
      // nothing removed the in-progress temp output.
      await fsp.rm(tempPath, { force: true });
      throw err;
    }

    await fsp.rm(job.outputPath, { force: true });
    await fsp.rename(tempPath, finalPath);
    job.outputPath = finalPath;
    job.filename = path.basename(finalPath);

    if (container) {
      await applyTags(job.outputPath, container, spec.tags);
    }
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").trim().slice(0, 150) || "media";
}

export const queueManager = new QueueManager();
export const scheduler = new Scheduler(queueManager);
