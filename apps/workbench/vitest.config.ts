import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Monorepo-root ui-kit is TS source (no build step); tests resolve it through the
// same alias as vite.config.ts so preview tests exercise the real kit components.
// workbench is apps/workbench → repo root is two levels up (worktree root = .worktrees/p1-editor).
const uiKitEntry = fileURLToPath(new URL("../../packages/ui-kit/src/index.ts", import.meta.url));

// 注意：vitest.config.ts 存在时 vitest 会完全忽略 vite.config.ts（插件/别名不会进测试）。
// 若测试需要 vite.config 的能力，把 test 块合并进 vite.config.ts，删除本文件。
export default defineConfig({
  resolve: {
    alias: {
      "@studio/ui-kit": uiKitEntry,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
