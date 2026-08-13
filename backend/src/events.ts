import { EventEmitter } from "node:events";
import type { WsEvent } from "./core/types.js";

/** Single process-wide bus: QueueManager emits, the WebSocket hub
 * (api/ws/wsServer.ts) is the only subscriber, broadcasting to every
 * connected client. Kept as a plain EventEmitter rather than a bigger
 * pub/sub library since this is a single-process, single-user backend. */
class DownloadEvents extends EventEmitter {
  emitWsEvent(event: WsEvent): void {
    this.emit("ws-event", event);
  }
}

export const downloadEvents = new DownloadEvents();
downloadEvents.setMaxListeners(50);
