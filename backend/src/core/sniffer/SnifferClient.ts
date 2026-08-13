import { config } from "../../config/index.js";
import type { SniffResult } from "../types.js";

export class SnifferServiceError extends Error {}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { result: SniffResult; expiresAt: number }>();

/** Thin proxy to the Python sniffer-service (see sniffer-service/app/main.py).
 * Backend never talks to Playwright/yt-dlp directly -- keeping that in a
 * separate process means a hung browser page can't take the download
 * queue down with it.
 *
 * Results are cached per page URL for a few minutes. This isn't just a
 * performance optimization: StreamDescriptor.id is generated fresh by the
 * sniffer-service on every call, so /api/sniff/grab -- which re-resolves
 * the URL to find the stream the client picked -- would essentially never
 * find a matching id without this cache keeping the ids stable for the
 * lifetime of one "sniff, then let the user pick a stream" interaction.
 *
 * `forceFresh` exists because that cache-read must NOT apply to an
 * explicit, user-initiated sniff (POST /api/sniff): on an SPA where
 * picking a different item doesn't change the page URL (e.g. Anghami --
 * clicking another track in "Recommended Songs" plays it in place without
 * navigating), re-clicking "Sniff" within the TTL window would otherwise
 * silently hand back the previous track's stream instead of resniffing.
 * Only the internal id-resolution call from createJobFromSniff wants the
 * cached read; every user-facing sniff always goes live and refreshes it. */
export async function sniffUrl(
  pageUrl: string,
  options?: { forceFresh?: boolean; signal?: AbortSignal },
): Promise<SniffResult> {
  const cached = cache.get(pageUrl);
  if (!options?.forceFresh && cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let res: Response;
  try {
    res = await fetch(`${config.snifferServiceUrl}/sniff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl }),
      signal: options?.signal,
    });
  } catch (err) {
    throw new SnifferServiceError(
      `Could not reach sniffer-service at ${config.snifferServiceUrl}: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new SnifferServiceError(`sniffer-service returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const result = (await res.json()) as SniffResult;
  cache.set(pageUrl, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
