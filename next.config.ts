import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vinext classifies multipart POST requests as possible progressive server
    // actions before dispatching API route handlers. Its 1 MB default blocked
    // otherwise-valid knowledge uploads before our 25 MB file validation ran.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
