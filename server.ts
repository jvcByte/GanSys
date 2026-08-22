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
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Resolve an absolute URL from a request without relying on deprecated
// `url.parse()` (which is non-standardized and has security implications).
function resolveUrl(rawUrl: string | undefined, hostHeader: string | undefined): URL {
  return new URL(rawUrl ?? "/", `http://${hostHeader ?? hostname}`);
}

// Build the request-URL shape Next's request handler expects, replicating the
// exact output of `url.parse(req.url, true)` for request-target URLs — relative
// href, null protocol/host — without using the deprecated `url.parse()` API.
function resolveParsedUrl(rawUrl: string | undefined, hostHeader: string | undefined): Parameters<typeof handle>[2] {
  const raw = rawUrl ?? "/";
  const hashIdx = raw.indexOf("#");
  const searchIdx = raw.indexOf("?");
  const cut =
    hashIdx === -1 && searchIdx === -1 ? -1
    : hashIdx === -1 ? searchIdx
    : searchIdx === -1 ? hashIdx
    : Math.min(hashIdx, searchIdx);
  const pathname = cut === -1 ? raw : raw.slice(0, cut);
  const search = searchIdx === -1 ? null : raw.slice(searchIdx, hashIdx === -1 ? undefined : hashIdx);
  const hash = hashIdx === -1 ? null : raw.slice(hashIdx);

  const query: Record<string, string | string[]> = {};
  if (search && search.length > 1) {
    for (const [key, value] of new URLSearchParams(search.slice(1)).entries()) {
      const existing = query[key];
      if (existing === undefined) {
        query[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        query[key] = [existing, value];
      }
    }
  }

  return {
    protocol: null,
    slashes: null,
    auth: null,
    host: null,
    port: null,
    hostname: null,
    hash,
    search,
    query,
    pathname,
    path: pathname + (search ?? ""),
    href: raw,
  } as unknown as Parameters<typeof handle>[2];
}

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
    const parsedUrl = resolveParsedUrl(req.url, req.headers.host);
    handle(req, res, parsedUrl);
  });

  // Upgrade HTTP connections to WebSocket for /api/ws
  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = resolveUrl(req.url, req.headers.host);
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
