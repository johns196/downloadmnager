import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Streams the file off disk rather than loading it into memory -- this
 * runs on every completed job, including multi-GB video files. */
export function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    const onAbort = () => stream.destroy(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    stream.on("end", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(hash.digest("hex"));
    });
  });
}
