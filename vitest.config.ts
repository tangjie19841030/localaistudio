import { defineConfig } from "vitest/config";

// Aggregates every workspace package's own vitest config so a single
// `npx vitest run` at the repo root runs all suites. Each matched directory
// resolves to its own vitest.config.ts (per-package settings stay intact);
// run a single suite via `cd <pkg> && npx vitest run`.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});
