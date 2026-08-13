import { Router } from "express";
import { queueManager } from "../../core/queue/QueueManager.js";
import type { JobSource } from "../../core/types.js";

export const jobsRouter = Router();

const VALID_SOURCES: JobSource[] = ["manual", "extension", "sniffer"];

jobsRouter.get("/", (_req, res) => {
  res.json(queueManager.listJobs());
});

jobsRouter.get("/:id", (req, res) => {
  const job = queueManager.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

jobsRouter.post("/", async (req, res) => {
  const { url, filename, chunks, mediaKind, source } = req.body ?? {};
  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "url is required" });
  }
  const resolvedSource: JobSource | undefined = VALID_SOURCES.includes(source) ? source : undefined;
  try {
    const job = await queueManager.createJob({ url, filename, chunks, mediaKind, source: resolvedSource });
    res.status(201).json(job);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

jobsRouter.post("/:id/pause", (req, res) => {
  try {
    res.json(queueManager.pause(req.params.id));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

jobsRouter.post("/:id/resume", (req, res) => {
  try {
    res.json(queueManager.resume(req.params.id));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

jobsRouter.post("/:id/throttle", (req, res) => {
  const { bytesPerSec } = req.body ?? {};
  if (bytesPerSec !== null && typeof bytesPerSec !== "number") {
    return res.status(400).json({ error: "bytesPerSec must be a number or null" });
  }
  try {
    res.json(queueManager.setThrottle(req.params.id, bytesPerSec));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

jobsRouter.delete("/:id", async (req, res) => {
  const deleteFile = req.query.deleteFile === "true";
  await queueManager.remove(req.params.id, deleteFile);
  res.status(204).end();
});
