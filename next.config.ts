import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: 'standalone',
  // The disposable UI workbench terminates TLS at Mona's nginx before
  // forwarding to this development server. Production builds ignore this
  // development-only origin allowance.
  allowedDevOrigins: ['earlybirds-staging.harmonicbeacon.com'],
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
      },
    ],
  },
};

export default nextConfig;
