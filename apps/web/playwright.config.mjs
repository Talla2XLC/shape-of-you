import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    headless: true,
    trace: "off"
  },
  webServer: {
    command: "node test/e2e/static-server.mjs",
    url: "http://localhost:4173/",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});
