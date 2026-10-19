import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR ?? process.env.NEXT_QA_DIST_DIR ?? ".next",
  // Server action arguments contain private guest-authored message content.
  logging: { incomingRequests: false, serverFunctions: false },
  outputFileTracingIncludes: {
    "/*": ["./content/*.json", "./public/assets/venue/*"],
  },
};

export default nextConfig;
