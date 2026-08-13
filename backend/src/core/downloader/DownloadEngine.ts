import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ChunkState } from "../types.js";
import { SpeedThrottle } from "./SpeedThrottle.js";

const MAX_RETRIES_PER_CHUNK = 5;
const RETRY_BASE_DELAY_MS = 500;

export interface RunJobOptions {
  url: string;
  outputPath: string;
  sizeBytes: number | null;
  supportsRange: boolean;
  chunks: ChunkState[]; // pre-planned, possibly partially downloaded already
  throttle: SpeedThrottle;
  signal: AbortSignal;
  onProgress: (downloadedBytes: number, speedBytesPerSec: number) => void;
  onChunkPersist: (chunks: ChunkState[]) => void;
}

/** Splits [0, sizeBytes) into `count` contiguous byte ranges. */
export function planChunks(sizeBytes: number, count: number): ChunkState[] {
  const chunkSize = Math.ceil(sizeBytes / count);
  const chunks: ChunkState[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, sizeBytes - 1);
    if (start > end) break;
    chunks.push({ index: i, start, end, downloaded: 0, done: false });
  }
  return chunks;
}

async function downloadChunk(
  url: string,
  fileHandle: fsp.FileHandle,
  chunk: ChunkState,
  supportsRange: boolean,
  throttle: SpeedThrottle,
  signal: AbortSignal,
  onBytes: (n: number) => void,
): Promise<void> {
  if (chunk.downloaded > 0 && chunk.start + chunk.downloaded > chunk.end) {
    chunk.done = true;
    return;
  }

  let attempt = 0;
  for (;;) {
    try {
      if (!supportsRange && chunk.downloaded > 0) {
        // Without Range support every request restarts the server's
        // response from byte 0 of the resource -- there's no way to ask
        // for "the rest". A retry has to discard whatever this chunk had
        // already written and start the write position over too, or the
        // freshly-restarted stream ends up written at the wrong file
        // offset (silent corruption, not just wasted bandwidth). Report
        // the discarded bytes back as a negative delta so the job's
        // overall downloadedBytes doesn't stay inflated by a failed,
        // thrown-away attempt.
        onBytes(-chunk.downloaded);
        chunk.downloaded = 0;
      }
      // Recomputed on every attempt, not hoisted above the loop: chunk.downloaded
      // keeps advancing as bytes land, so a retry after a mid-chunk drop must
      // resume from the *current* value, not the offset the chunk started this
      // whole call at -- otherwise the retry re-downloads from the original
      // start while chunk.downloaded keeps counting from the failed attempt,
      // overstating progress and (on a later pause) marking the chunk "done"
      // before the true remaining bytes are ever written.
      const startByte = chunk.start + chunk.downloaded;

      // Accept-Encoding: identity keeps byte offsets consistent with the
      // Content-Length probeUrl() saw -- see the comment in probeUrl.ts.
      const headers: Record<string, string> = {
        "User-Agent": "DownloadManager/0.1 (+multi-threaded downloader)",
        "Accept-Encoding": "identity",
      };
      if (supportsRange) headers.Range = `bytes=${startByte}-${chunk.end}`;

      const res = await fetch(url, { headers, signal });
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status} for chunk ${chunk.index}`);
      }
      if (!res.body) throw new Error(`Empty body for chunk ${chunk.index}`);

      let position = startByte;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await throttle.consume(value.byteLength, signal);
        await fileHandle.write(value, 0, value.byteLength, position);
        position += value.byteLength;
        chunk.downloaded += value.byteLength;
        onBytes(value.byteLength);
      }
      chunk.done = true;
      return;
    } catch (err) {
      if (signal.aborted) throw err; // pause/cancel, not a network failure
      attempt++;
      if (attempt >= MAX_RETRIES_PER_CHUNK) {
        throw new Error(
          `Chunk ${chunk.index} failed after ${MAX_RETRIES_PER_CHUNK} attempts: ${(err as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Runs (or resumes) every incomplete chunk of a job in parallel, writing
 * directly into a preallocated file at each chunk's byte offset. Progress
 * and periodic chunk-state persistence flow back through the callbacks so
 * the caller (QueueManager) can push WebSocket updates and survive a
 * process restart without losing more than a few seconds of progress.
 */
export async function runJob(opts: RunJobOptions): Promise<void> {
  const { url, outputPath, sizeBytes, supportsRange, chunks, throttle, signal, onProgress, onChunkPersist } =
    opts;

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  // Preallocate so out-of-order chunk writes never produce a sparse-file
  // surprise or an undersized file if the process dies mid-download.
  const fileHandle = await fsp.open(outputPath, "r+").catch(() => fsp.open(outputPath, "w"));
  if (sizeBytes) {
    const stat = await fileHandle.stat();
    if (stat.size !== sizeBytes) await fileHandle.truncate(sizeBytes);
  }

  let totalDownloaded = chunks.reduce((sum, c) => sum + c.downloaded, 0);
  let windowBytes = 0;
  let windowStart = Date.now();
  const persistTimer = setInterval(() => onChunkPersist(chunks), 2000);

  const speedTimer = setInterval(() => {
    const elapsed = (Date.now() - windowStart) / 1000;
    const speed = elapsed > 0 ? windowBytes / elapsed : 0;
    onProgress(totalDownloaded, speed);
    windowBytes = 0;
    windowStart = Date.now();
  }, 1000);

  const onBytesFactory = () => (n: number) => {
    totalDownloaded += n;
    windowBytes += n;
  };

  try {
    const pending = chunks.filter((c) => !c.done);
    await Promise.all(
      pending.map((chunk) =>
        downloadChunk(url, fileHandle, chunk, supportsRange, throttle, signal, onBytesFactory()),
      ),
    );
  } finally {
    clearInterval(persistTimer);
    clearInterval(speedTimer);
    onChunkPersist(chunks);
    await fileHandle.close();
  }

  onProgress(totalDownloaded, 0);
}

export function fileExistsSync(p: string): boolean {
  return fs.existsSync(p);
}
