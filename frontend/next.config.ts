import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: {
    proxyClientMaxBodySize: "100mb",
    proxyTimeout: 300_000,
  },
  async rewrites() {
    const configuredUrl = process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim();
    if (!configuredUrl && process.env.VERCEL) return [];
    const backendUrl = (configuredUrl || "http://127.0.0.1:8000").replace(/\/$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
