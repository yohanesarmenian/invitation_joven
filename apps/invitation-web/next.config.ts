import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Server action arguments contain private guest-authored message content.
  logging: { serverFunctions: false },
};

export default nextConfig;
