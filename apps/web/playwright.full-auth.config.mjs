import { defineConfig } from "@playwright/test";

const baseURL = process.env.BROWSER_AUTH_E2E_BASE_URL;
if (!baseURL) throw new Error("BROWSER_AUTH_E2E_BASE_URL is required");

export default defineConfig({
  testDir: "./test/full-auth-e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "off",
    trace: "off",
    video: "off"
  }
});
