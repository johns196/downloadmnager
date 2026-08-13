import { spawn } from "node:child_process";
import type { TargetContainer } from "../types.js";

export class FFmpegError extends Error {}

function parseDurationSeconds(line: string): number | null {
  const m = line.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseTimeSeconds(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

interface RunOpts {
  onProgress?: (fractionComplete: number | null) => void;
  signal?: AbortSignal;
}

function runFfmpeg(args: string[], { onProgress, signal }: RunOpts = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-hide_banner", ...args], { signal });
    let durationSeconds: number | null = null;
    let stderrTail = "";

    proc.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      durationSeconds ??= parseDurationSeconds(text);
      const t = parseTimeSeconds(text);
      if (onProgress && t !== null) {
        onProgress(durationSeconds ? Math.min(1, t / durationSeconds) : null);
      }
    });

    proc.on("error", (err) => reject(new FFmpegError(`ffmpeg spawn failed: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new FFmpegError(`ffmpeg exited with code ${code}: ${stderrTail.split("\n").slice(-5).join(" | ")}`));
      }
    });
  });
}

const AUDIO_CODEC_FOR: Record<string, string[]> = {
  mp3: ["-acodec", "libmp3lame", "-q:a", "2"],
  flac: ["-acodec", "flac"],
  m4a: ["-acodec", "aac", "-b:a", "256k"],
};

/**
 * Feeds an HLS (.m3u8) or DASH (.mpd) manifest URL -- or a set of already
 * downloaded segment files -- straight into ffmpeg, which handles
 * segment fetch + concatenation + (re)muxing in one pass. This is the
 * primary path for turning sniffed streams into finished files; it avoids
 * hand-rolling HLS segment logic in the downloader.
 */
export async function muxFromManifest(
  manifestUrl: string,
  outputPath: string,
  opts: RunOpts = {},
): Promise<void> {
  await runFfmpeg(
    ["-i", manifestUrl, "-c", "copy", "-bsf:a", "aac_adtstoasc", outputPath],
    opts,
  ).catch(async (err) => {
    // -c copy fails when the source needs remuxing/timestamp fixes (common
    // with some HLS variants); retry once with a full re-encode.
    if (opts.signal?.aborted) throw err;
    await runFfmpeg(["-i", manifestUrl, outputPath], opts);
  });
}

export async function extractAudio(
  inputPath: string,
  outputPath: string,
  container: TargetContainer,
  opts: RunOpts = {},
): Promise<void> {
  const codecArgs = AUDIO_CODEC_FOR[container];
  if (!codecArgs) throw new FFmpegError(`extractAudio: unsupported container "${container}"`);
  await runFfmpeg(["-i", inputPath, "-vn", ...codecArgs, outputPath], opts);
}

export async function transcode(
  inputPath: string,
  outputPath: string,
  _container: TargetContainer,
  opts: RunOpts = {},
): Promise<void> {
  await runFfmpeg(["-i", inputPath, outputPath], opts);
}

export async function remux(inputPath: string, outputPath: string, opts: RunOpts = {}): Promise<void> {
  await runFfmpeg(["-i", inputPath, "-c", "copy", outputPath], opts);
}

export async function probeDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (b: Buffer) => (out += b.toString()));
    proc.on("close", (code) => {
      const value = Number(out.trim());
      resolve(code === 0 && Number.isFinite(value) ? value : null);
    });
    proc.on("error", () => resolve(null));
  });
}
