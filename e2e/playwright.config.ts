import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  workers: 1,
  use: { baseURL: "http://localhost:5173" },
  webServer: [
    {
      command: "pnpm --filter @studio/server dev",
      url: "http://127.0.0.1:8787/api/health",
      cwd: "..",
      env: { STUDIO_DATA_DIR: "e2e/.data" },
      // Task 4 审查采纳（I3）：不复用来路不明的既有进程——复用会让 E2E 写进开发者真实 data/
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @studio/workbench dev",
      url: "http://localhost:5173",
      cwd: "..",
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
