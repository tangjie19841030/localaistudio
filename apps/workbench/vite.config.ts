import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Monorepo-root ui-kit is TS source (no build step); alias makes Vite compile it directly.
// workbench is apps/workbench → repo root is two levels up (worktree root = .worktrees/p1-editor).
const uiKitEntry = fileURLToPath(new URL("../../packages/ui-kit/src/index.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@studio/ui-kit": uiKitEntry,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});

// 注意：测试运行读的是独立的 vitest.config.ts；本文件的插件/别名不影响测试。
