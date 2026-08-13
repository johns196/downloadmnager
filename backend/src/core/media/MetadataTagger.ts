import fsp from "node:fs/promises";
import path from "node:path";
import NodeID3 from "node-id3";
import type { PostProcessTags, TargetContainer } from "../types.js";

async function fetchArtwork(url: string | undefined): Promise<Buffer | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** MP3 gets real ID3v2 tags (including embedded artwork) via node-id3,
 * since ffmpeg's -metadata flags produce weaker ID3 support in some
 * players than a purpose-built tagger. */
export async function tagMp3(filePath: string, tags: PostProcessTags): Promise<void> {
  const artwork = await fetchArtwork(tags.artworkUrl);
  const id3Tags: NodeID3.Tags = {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
  };
  if (artwork) {
    id3Tags.image = { mime: "image/jpeg", type: { id: 3, name: "front cover" }, description: "", imageBuffer: artwork };
  }
  const ok = NodeID3.write(id3Tags, filePath);
  if (ok !== true) throw new Error(`Failed to write ID3 tags to ${filePath}`);
}

/** FLAC / M4A / MP4 / MKV: re-mux with -metadata flags via ffmpeg, since
 * these containers use their own tag formats (Vorbis comments, MP4 atoms)
 * that ffmpeg already knows how to write correctly. */
export async function tagWithFfmpeg(
  filePath: string,
  container: TargetContainer,
  tags: PostProcessTags,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  const tmpPath = path.join(path.dirname(filePath), `.tag-${Date.now()}${path.extname(filePath)}`);
  const metadataArgs: string[] = [];
  if (tags.title) metadataArgs.push("-metadata", `title=${tags.title}`);
  if (tags.artist) metadataArgs.push("-metadata", `artist=${tags.artist}`);
  if (tags.album) metadataArgs.push("-metadata", `album=${tags.album}`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", "-hide_banner", "-i", filePath, "-c", "copy", ...metadataArgs, tmpPath]);
    let stderr = "";
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-500)))));
    proc.on("error", reject);
  });

  await fsp.rename(tmpPath, filePath);
}

export async function applyTags(
  filePath: string,
  container: TargetContainer,
  tags: PostProcessTags | null,
): Promise<void> {
  if (!tags) return;
  if (container === "mp3") {
    await tagMp3(filePath, tags);
  } else {
    await tagWithFfmpeg(filePath, container, tags);
  }
}
