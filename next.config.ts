import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ['10.218.149.202'],
  serverExternalPackages: ["postgres", "@neondatabase/serverless"],
};

export default nextConfig;
