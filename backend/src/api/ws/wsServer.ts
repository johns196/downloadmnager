import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { downloadEvents } from "../../events.js";
import type { WsEvent } from "../../core/types.js";

/** Single broadcast channel: every connected client (Flutter app, extension
 * popup) gets every event. There is no per-client subscription filtering --
 * this is a single-user local tool, and job lists are small. */
export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const broadcast = (event: WsEvent) => {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  };

  downloadEvents.on("ws-event", broadcast);

  wss.on("connection", (socket) => {
    socket.on("message", () => {
      // Clients only ever send an optional {"type":"subscribe"} ping; no
      // server-side action is needed since broadcasts already go to all.
    });
  });

  return wss;
}
