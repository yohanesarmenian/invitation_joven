import type { NextConfig } from "next";
import { getAdminApiBaseUrl } from "./src/auth/api-config";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR ?? process.env.NEXT_QA_DIST_DIR ?? ".next",
  async rewrites() {
    return [
      {
        source: "/api/admin/:path*",
        destination: `${getAdminApiBaseUrl()}/api/admin/:path*`,
      },
    ];
  },
};

export default nextConfig;
