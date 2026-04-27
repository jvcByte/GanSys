/**
 * Custom Next.js server.
 * Attaches the WebSocket server to the HTTP upgrade event and
 * initialises the MQTT client singleton on startup.
 *
 * Usage:
 *   Development:  npx tsx server.ts
 *   Production:   node server.js  (after `npm run build`)
 */

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Initialise MQTT client (subscribes to broker topics)
  // Import is deferred so Next.js module resolution is ready first
  import("@/lib/mqtt/client").then(({ mqttClient }) => {
    if (mqttClient) {
      console.log("[Server] MQTT client initialised.");
    }
  }).catch((err) => console.error("[Server] MQTT init error:", err));

  // Initialise scheduled command processor
  import("@/lib/scheduler").then(({ startScheduler }) => {
    startScheduler();
    console.log("[Server] Scheduled command processor initialised.");
  }).catch((err) => console.error("[Server] Scheduler init error:", err));

  // Create WebSocket server
  const { createWss } = require("./src/lib/ws/server") as typeof import("./src/lib/ws/server");
  const wss = createWss();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  // Upgrade HTTP connections to WebSocket for /api/ws
  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/");
    if (pathname === "/api/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  httpServer.listen(port, hostname, () => {
    console.log(`[Server] Ready on http://${hostname}:${port}`);
  });
});
