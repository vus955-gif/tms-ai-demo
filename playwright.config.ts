import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Tests in one file run in order; on CI three files run side by side. Each test plays in its own demo world
  // (a fresh browser context has no cookie), so they do not share state.
  fullyParallel: false,
  workers: CI ? 3 : 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
    trace: "retain-on-failure",
    // The first-visit guide opens over the work area; the flows start with it closed (guide.spec.ts opens it on purpose).
    storageState: { cookies: [], origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: "tms-guide", value: '{"open":false,"done":[]}' }] }] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // CI tests the production build: pages are ready at once instead of compiling on first visit under three
    // workers, and the build itself gets checked. Locally the dev server (or one already running) is enough.
    command: CI ? "npm run build && npm run start" : "npm run dev",
    port: PORT,
    reuseExistingServer: !CI,
    timeout: 300_000,
    // The flows are written for the rule-based fallback; a key in .env.local must not make them depend on the model
    // (or on network access). Next keeps variables already set in the environment, so empty values win over .env.local.
    // AI quality is measured separately: npm run eval:ai.
    // All workers come from one address; past 20 new worlds a day the server would start recycling
    // worlds that other tests are still using.
    env: {
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      PORT: String(PORT),
      SANDBOXES_PER_IP_PER_DAY: "1000",
      // `next build` opens the local database too (prerendering, in several processes); on disk that left
      // ./.pglite unusable for `next start`. In memory each process gets its own, and every CI run starts clean.
      ...(CI ? { PGLITE_DIR: "memory://" } : {}),
    },
  },
});
