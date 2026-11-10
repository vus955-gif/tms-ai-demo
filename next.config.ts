import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships a WASM build of Postgres that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Precomputed routes, migrations and CMR samples (sent to AI) are read from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./data/routes/**", "./drizzle/**", "./public/cmr-samples/**"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
  async redirects() {
    return [{ source: "/", destination: "/monitoring", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
