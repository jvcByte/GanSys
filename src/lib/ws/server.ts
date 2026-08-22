import type { IncomingMessage } from "node:http";
import type { WebSocket as WsSocket } from "ws";
import { WebSocketServer } from "ws";

import { getCurrentUserFromToken } from "@/lib/auth";
import type { WsMessage } from "@/lib/types";
import { rateLimit } from "@/lib/rate-limit";

// Per-user socket registry: userId → set of open sockets
const registry = new Map<string, Set<WsSocket>>();

const MAX_SOCKETS_PER_USER = 10;
const HEARTBEAT_INTERVAL_MS = 30_000;

function wsClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() || "unknown";
  if (Array.isArray(forwarded)) return forwarded[0]?.split(",")[0]?.trim() || "unknown";
  return req.socket.remoteAddress ?? "unknown";
}

// Configured browser origins allowed to open WebSocket connections.
// Same-origin connections are the default; set ALLOWED_ORIGINS (comma-separated)
// to enforce an explicit allowlist in production.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

declare global {
  // eslint-disable-next-line no-var
  var __gansys_wss__: WebSocketServer | undefined;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients (CLI tools, device bridges) may omit the Origin header.
  if (!origin) return true;
  // No explicit allowlist configured → allow (matches previous behavior).
  if (!allowedOrigins.length) return true;
  return allowedOrigins.includes(origin);
}

export function broadcastToUser(userId: string, message: WsMessage): void {
  const sockets = registry.get(userId);
  if (!sockets?.size) return;
  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === 1 /* OPEN */) {
      socket.send(payload);
    } else {
      sockets.delete(socket);
    }
  }
}

export function registerSocket(userId: string, socket: WsSocket): void {
  const sockets = registry.get(userId) ?? new Set();
  sockets.add(socket);
  registry.set(userId, sockets);

  socket.on("close", () => {
    sockets.delete(socket);
    if (!sockets.size) registry.delete(userId);
  });
}

export function createWss(): WebSocketServer {
  if (globalThis.__gansys_wss__) return globalThis.__gansys_wss__;

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (socket: WsSocket, req: IncomingMessage) => {
    // Reject cross-origin upgrade attempts before authenticating.
    if (!isAllowedOrigin(req.headers.origin)) {
      socket.close(4003, "Origin not allowed");
      return;
    }

    // Bound connection attempts per client IP.
    if (!rateLimit(`ws:${wsClientIp(req)}`, 20, 60_000)) {
      socket.close(4004, "Rate limit exceeded");
      return;
    }

    const sessionToken = req.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("gansys_session="))
      ?.slice("gansys_session=".length);
    const user = sessionToken ? await getCurrentUserFromToken(sessionToken) : null;
    if (!user) {
      socket.close(4001, "Authentication required");
      return;
    }

    // Cap concurrent connections per user to limit abuse.
    const current = registry.get(user.id);
    if (current && current.size >= MAX_SOCKETS_PER_USER) {
      socket.close(4002, "Too many connections");
      return;
    }

    // Heartbeat bookkeeping: sockets must pong to stay alive.
    (socket as WsSocket & { isAlive?: boolean }).isAlive = true;
    socket.on("pong", () => {
      (socket as WsSocket & { isAlive?: boolean }).isAlive = true;
    });

    registerSocket(user.id, socket);
    socket.send(JSON.stringify({ type: "connected" }));
  });

  // Terminate dead connections that stop answering pings.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const ws = socket as WsSocket & { isAlive?: boolean };
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  if (process.env.NODE_ENV !== "production") {
    globalThis.__gansys_wss__ = wss;
  }

  return wss;
}
