import { defineConfig, devices } from "@playwright/test";

/**
 * Drives a running Trove KB instance. Start one first, for example:
 *   ENV_FILE=.env.test APP_PORT=3090 docker compose -p trove-kb-test up -d
 * then: ENV_FILE=.env.test E2E_BASE_URL=http://127.0.0.1:3090 npm run test:e2e
 *
 * ENV_FILE matters to the run too: the OIDC test recreates the app container.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3090",
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // The OIDC test's provider is reachable as mock-oidc:<E2E_OIDC_PORT>
          // from the app container; map that name to the published port for
          // the browser.
          args: ["--host-resolver-rules=MAP mock-oidc 127.0.0.1"],
        },
      },
    },
  ],
});
