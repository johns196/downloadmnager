import { Router } from "express";
import { queueManager } from "../../core/queue/QueueManager.js";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(queueManager.getSettings());
});

settingsRouter.put("/", (req, res) => {
  const { maxConcurrentJobs, maxChunksPerJob, globalBandwidthCap } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (maxConcurrentJobs !== undefined) patch.maxConcurrentJobs = maxConcurrentJobs;
  if (maxChunksPerJob !== undefined) patch.maxChunksPerJob = maxChunksPerJob;
  if (globalBandwidthCap !== undefined) patch.globalBandwidthCap = globalBandwidthCap;
  res.json(queueManager.updateSettings(patch));
});
