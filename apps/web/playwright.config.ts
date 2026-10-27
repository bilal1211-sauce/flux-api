import { defineConfig, devices } from "@playwright/test";

const database = process.env.E2E_DATABASE_NAME || "";
const username = process.env.E2E_DATABASE_USER || "";
const apiOrigin = process.env.E2E_API_ORIGIN || "";
const baseURL = process.env.E2E_BASE_URL || "";

if (
  process.env.E2E_ISOLATED_DB !== "1" ||
  !/^fluxapi_e2e_phase7_[a-f0-9]{12}$/.test(database) ||
  !/^fluxapi_e2e_[a-f0-9]{12}$/.test(username) ||
  apiOrigin !== "http://127.0.0.1:8104" ||
  baseURL !== "http://127.0.0.1:3001"
) {
  throw new Error(
    "Playwright is locked to the isolated Phase 7 E2E harness. Run `npm run test:e2e`; direct runs without its verified database will stop before tests.",
  );
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: "list",
  globalSetup: "./tests/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
});
