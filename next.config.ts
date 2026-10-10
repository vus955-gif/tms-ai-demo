import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships a WASM build of Postgres that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Precomputed routes and migrations are read from disk at runtime.
  outputFileTracingIncludes: {
    "/api/**": ["./data/routes/**", "./drizzle/**"],
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
