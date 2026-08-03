import type { NextConfig } from "next";
import { validateCoreEnv } from "./src/lib/env";

// This runs only when Next.js loads its config. Prisma CLI commands such as
// `prisma generate` can still run independently with their own requirements.
validateCoreEnv();

const nextConfig: NextConfig = {
  // Vercel-compatible settings
  output: undefined, // default — Vercel handles this automatically
  images: {
    unoptimized: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
