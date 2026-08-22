import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The production entrypoint is the custom server (server.ts bundled to
  // dist/server.js), which starts HTTP + WebSocket + MQTT + scheduler.
  // `output: "standalone"` is intentionally NOT used because the programmatic
  // `next({ dev: false })` API is incompatible with standalone output.
  allowedDevOrigins: ['10.218.149.202'],
  serverExternalPackages: ["postgres", "@neondatabase/serverless"],
};

export default nextConfig;
