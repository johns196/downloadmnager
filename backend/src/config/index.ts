import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

function resolveDir(p: string): string {
  const abs = path.resolve(process.cwd(), p);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  snifferServiceUrl: process.env.SNIFFER_SERVICE_URL ?? "http://127.0.0.1:8788",
  downloadsDir: resolveDir(process.env.DOWNLOADS_DIR ?? "./downloads"),
  dataDir: resolveDir(process.env.DATA_DIR ?? "./data"),
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH ?? "./data/download-manager.db"),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 3),
  maxChunksPerJob: Number(process.env.MAX_CHUNKS_PER_JOB ?? 8),
  defaultChunksPerJob: Number(process.env.DEFAULT_CHUNKS_PER_JOB ?? 4),
} as const;
