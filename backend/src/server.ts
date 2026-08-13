import http from "node:http";
import express from "express";
import cors from "cors";
import { config } from "./config/index.js";
import { jobsRouter } from "./api/routes/jobs.js";
import { settingsRouter } from "./api/routes/settings.js";
import { sniffRouter } from "./api/routes/sniff.js";
import { scheduleRouter } from "./api/routes/schedule.js";
import { attachWebSocketServer } from "./api/ws/wsServer.js";
import { scheduler } from "./core/queue/QueueManager.js";

const app = express();

// Localhost-only tool: CORS is opened for the extension's content-script
// origin and any http://localhost:* dev server the Flutter web target uses,
// never for arbitrary remote origins.
app.use(
  cors({
    origin: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^http:\/\/127\.0\.0\.1(:\d+)?$/, /^http:\/\/localhost(:\d+)?$/],
  }),
);
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/jobs", jobsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/sniff", sniffRouter);
app.use("/api/schedule", scheduleRouter);

// Lets the Flutter client stream/preview a completed file directly (range
// requests supported natively by express.static) without a separate
// media server.
app.use("/downloads", express.static(config.downloadsDir));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const httpServer = http.createServer(app);
attachWebSocketServer(httpServer);
scheduler.start();

httpServer.listen(config.port, config.host, () => {
  console.log(`Download Manager backend listening on http://${config.host}:${config.port}`);
  console.log(`WebSocket at ws://${config.host}:${config.port}/ws`);
});

process.on("SIGTERM", () => httpServer.close(() => process.exit(0)));
process.on("SIGINT", () => httpServer.close(() => process.exit(0)));
