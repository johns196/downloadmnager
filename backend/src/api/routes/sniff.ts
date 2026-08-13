import { Router } from "express";
import { sniffUrl } from "../../core/sniffer/SnifferClient.js";
import { queueManager } from "../../core/queue/QueueManager.js";

export const sniffRouter = Router();

sniffRouter.post("/", async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "url is required" });
  }
  try {
    const result = await sniffUrl(url);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

sniffRouter.post("/grab", async (req, res) => {
  const { url, streamId, postProcess } = req.body ?? {};
  if (typeof url !== "string" || typeof streamId !== "string") {
    return res.status(400).json({ error: "url and streamId are required" });
  }
  try {
    const job = await queueManager.createJobFromSniff(url, streamId, postProcess ?? null);
    res.status(201).json(job);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
