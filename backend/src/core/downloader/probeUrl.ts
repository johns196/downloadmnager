import path from "node:path";

export interface ProbeResult {
  sizeBytes: number | null;
  supportsRange: boolean;
  suggestedFilename: string;
  contentType: string | null;
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname);
    return base && base !== "/" ? decodeURIComponent(base) : "download";
  } catch {
    return "download";
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : null;
}

/**
 * HEAD-probes a URL to figure out size and range support before committing
 * to a chunk plan. Falls back to a ranged GET for servers that mishandle
 * HEAD (surprisingly common), reading zero bytes of body either way.
 */
export async function probeUrl(url: string, signal?: AbortSignal): Promise<ProbeResult> {
  // Accept-Encoding: identity is load-bearing here, not cosmetic: Node's
  // fetch (undici) transparently decompresses gzip/br bodies but leaves
  // Content-Length as the *compressed* wire size, and range servers apply
  // byte offsets to the underlying resource. Without this header, size
  // probing and chunk math silently go out of sync (undersized final
  // file, or 416s on later chunks) on any server that compresses text
  // responses -- which is most of them.
  const headers = {
    "User-Agent": "DownloadManager/0.1 (+multi-threaded downloader)",
    "Accept-Encoding": "identity",
  };

  let res: Response;
  try {
    res = await fetch(url, { method: "HEAD", headers, signal });
  } catch {
    res = await fetch(url, { method: "GET", headers: { ...headers, Range: "bytes=0-0" }, signal });
  }

  if (!res.ok && res.status !== 206) {
    // Some servers 405 on HEAD; retry with a minimal ranged GET.
    res = await fetch(url, { method: "GET", headers: { ...headers, Range: "bytes=0-0" }, signal });
  }

  const acceptRanges = res.headers.get("accept-ranges");
  const contentRange = res.headers.get("content-range");
  const contentLengthHeader = res.headers.get("content-length");

  let sizeBytes: number | null = null;
  if (contentRange) {
    const total = contentRange.split("/")[1];
    if (total && total !== "*") sizeBytes = Number(total);
  } else if (contentLengthHeader) {
    sizeBytes = Number(contentLengthHeader);
  }

  const supportsRange =
    res.status === 206 || (acceptRanges !== null && acceptRanges.toLowerCase() === "bytes");

  const suggestedFilename =
    filenameFromContentDisposition(res.headers.get("content-disposition")) ??
    filenameFromUrl(url);

  // Drain body if we accidentally fetched one (ranged GET fallback).
  if (res.body) {
    try {
      await res.body.cancel();
    } catch {
      /* ignore */
    }
  }

  return {
    sizeBytes: sizeBytes && Number.isFinite(sizeBytes) ? sizeBytes : null,
    supportsRange,
    suggestedFilename,
    contentType: res.headers.get("content-type"),
  };
}
