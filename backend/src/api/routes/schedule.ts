import { Router } from "express";
import { scheduler } from "../../core/queue/QueueManager.js";

export const scheduleRouter = Router();

scheduleRouter.get("/", (_req, res) => {
  res.json(scheduler.getRules());
});

scheduleRouter.put("/", (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: "Body must be an array of ScheduleRule" });
  }
  res.json(scheduler.setRules(req.body));
});
