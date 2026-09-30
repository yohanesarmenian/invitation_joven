import type { NextConfig } from "next";
import { getAdminApiBaseUrl } from "./src/auth/api-config";

const nextConfig: NextConfig = {
  agentRules: false,
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
