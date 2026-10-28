import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root so Next doesn't guess it from unrelated lockfiles in parent folders.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
