import { serve } from "@hono/node-server";
import { checkScope, setSvgParser } from "@studio/schema-core";
import { createApp } from "./app.js";
import { ensureProjectsDir, getDataDir } from "./paths.js";
import { createProjectsStore } from "./store/projects.js";
import type { GuardedOp, ScopeChecker } from "./ai/patchGuard.js";

// W5: jsdom DOMParser for schema-core's injected SVG validator (node has none);
// on failure validation stays fail-closed (报"解析器不可用"). jsdom ships no types.
const jsdomSpecifier = "jsdom";
void import(jsdomSpecifier).then((m) => {
  const dp = new (new m.JSDOM("").window.DOMParser)() as { parseFromString(s: string, t: string): { documentElement: Element | null } };
  setSvgParser((source) => dp.parseFromString(source, "image/svg+xml").documentElement);
}).catch((err: unknown) => console.warn("[server] jsdom 不可用，SVG 校验 fail-closed:", err));

/** Scope interception backed by schema-core checkScope (P2-1 patch engine). */
const scopeChecker: ScopeChecker = (ops: GuardedOp[], scope) =>
  checkScope(ops as Parameters<typeof checkScope>[0], scope);

const port = Number.parseInt(process.env.PORT ?? "8787", 10) || 8787;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[server] 非法端口值: ${process.env.PORT}`);
  process.exit(1);
}
const projectsDir = ensureProjectsDir(); // 先确保目录可写，再对外宣告服务
const store = createProjectsStore(projectsDir);
const app = createApp(store, { dataDir: getDataDir(), scopeChecker });

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[server] Local AI UI Studio 本地服务: http://127.0.0.1:${info.port}`);
  console.log(`[server] 项目目录: ${projectsDir}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] 端口 ${port} 已被占用——请先停止占用该端口的进程（残留 dev server？）再重启。`);
    process.exit(1);
  }
  console.error(`[server] 启动失败:`, err);
  process.exit(1);
});
