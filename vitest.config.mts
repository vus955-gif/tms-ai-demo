import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    env: { PGLITE_DIR: "memory://" },
    exclude: ["e2e/**", "node_modules/**"],
    testTimeout: 20000,
    // Each test file builds its own in-memory Postgres and applies every migration in beforeAll;
    // with dozens of files starting at once that can take longer than the default 10 s.
    hookTimeout: 30000,
  },
});
