/**
 * Browser end-to-end tests (Playwright). Separate from `npm test` (Vitest, fully mocked).
 *
 *   npm run test:e2e        smoke suite: read-only, no Claude/PayPal calls; safe against the shared Render demo
 *   npm run test:e2e:full   full suite (@full): calls Claude and the PayPal sandbox and changes data; localhost only
 *
 * Target another deployment with E2E_BASE_URL (default http://localhost:3000; start the app first).
 */
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  // A free Render instance can take ~50s to wake up; AI calls take up to 30s.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // The full suite changes shared state (demo clock, proposals), so run one test at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    navigationTimeout: 90_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
