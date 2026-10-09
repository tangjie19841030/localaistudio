import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// apps/server/src/preview/processes.ts → repo root (processes.ts → preview → src → server → apps → root)
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
// pnpm's hoisted layout keeps vite under the workbench app (declared dep), not the
// repo root node_modules — resolve through workbench's symlinked copy.
const viteBin = resolve(repoRoot, "apps", "workbench", "node_modules", "vite", "bin", "vite.js");
// pnpm entry: prefer the local shim home, fall back to whatever is on PATH via .cmd.
const pnpmCjs = resolve(process.env.USERPROFILE ?? "", ".local", "pnpm", "package", "bin", "pnpm.cjs");

export const PREVIEW_PORT_START = 5180;
export const PREVIEW_PORT_END = 5199;
const START_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const INSTALL_TIMEOUT_MS = 300_000;
const INSTALL_MARKER = ".studio-install-complete";
const INSTALL_MARKER_CONTENT = "ok\n";

export type SpawnFn = typeof spawn;
export type FetchFn = (url: string) => Promise<Response>;

export interface PreviewEntry {
  projectId: string;
  port: number;
  pid: number;
}

export interface PreviewManager {
  /** Spawn vite dev for the project; reuse the running one and return its port. */
  start(projectId: string, projectDir: string): Promise<{ port: number }>;
  /** Kill the project's preview process tree; no-op if not running. */
  stop(projectId: string): Promise<void>;
  status(): PreviewEntry[];
  shutdownAll(): Promise<void>;
}

interface ManagedProcess {
  entry: PreviewEntry;
  child: ChildProcess;
}

/** A Response-like is enough for the readiness probe — status code is ignored. */
function isUp(r: unknown): r is Response {
  return r instanceof Response;
}

async function pollUntilReady(
  child: ChildProcess,
  port: number,
  fetchFn: FetchFn,
  startTimeoutMs: number,
  pollIntervalMs: number,
): Promise<void> {
  const deadline = Date.now() + startTimeoutMs;
  let stdoutSawReady = false;
  const onData = (chunk: Buffer | string) => {
    if (String(chunk).includes("Local:")) stdoutSawReady = true;
  };
  child.stdout?.on("data", onData);

  while (Date.now() < deadline) {
    if (stdoutSawReady) return;
    try {
      if (isUp(await fetchFn(`http://127.0.0.1:${port}`))) return;
    } catch {
      // not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`预览进程启动超时（${startTimeoutMs / 1000}s）：端口 ${port} 未就绪`);
}

/** Windows needs taskkill /T to reap the whole child tree (node kill won't). */
async function killTree(child: ChildProcess, spawnFn: SpawnFn): Promise<void> {
  if (process.platform === "win32" && typeof child.pid === "number") {
    await new Promise<void>((resolvePromise) => {
      const killer = spawnFn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.on("error", () => {
        child.kill();
        resolvePromise();
      });
      killer.on("close", () => resolvePromise());
    });
    return;
  }
  child.kill();
}

export interface PreviewManagerOptions {
  /** Readiness probe budget; default 30s (tests shrink it). */
  startTimeoutMs?: number;
  /** Readiness probe interval; default 200ms. */
  pollIntervalMs?: number;
  /** First-start install budget; default 300s (offline pnpm store makes it fast). */
  installTimeoutMs?: number;
}

interface InstallAttempt {
  ok: boolean;
  code?: number | null;
  timedOut?: boolean;
  error?: unknown;
}

function installMarkerPath(projectDir: string): string {
  return resolve(projectDir, "node_modules", INSTALL_MARKER);
}

async function clearIncompleteInstall(projectDir: string): Promise<void> {
  await fs.rm(resolve(projectDir, "node_modules"), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

/**
 * Preview process registry. spawnFn/fetchFn are injection seams for tests
 * (fake child + fake fetch) so unit tests never spawn a real vite.
 */
export function createPreviewManager(
  spawnFn: SpawnFn = spawn,
  fetchFn: FetchFn = (url) => fetch(url),
  opts?: PreviewManagerOptions,
): PreviewManager {
  const startTimeoutMs = opts?.startTimeoutMs ?? START_TIMEOUT_MS;
  const pollIntervalMs = opts?.pollIntervalMs ?? POLL_INTERVAL_MS;
  const installTimeoutMs = opts?.installTimeoutMs ?? INSTALL_TIMEOUT_MS;
  const running = new Map<string, ManagedProcess>();

  /**
   * Run one install attempt with its own timeout. Timeout waits for the process
   * tree cleanup before resolving so a fallback cannot overlap the dead process.
   */
  function runInstallAttempt(projectDir: string, args: string[]): Promise<InstallAttempt> {
    return new Promise((resolveAttempt) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let child: ChildProcess;

      const finish = (result: InstallAttempt): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolveAttempt(result);
      };

      try {
        child = spawnFn(process.execPath, [pnpmCjs, ...args], {
          cwd: projectDir,
          env: { ...process.env, NO_COLOR: "1" },
          stdio: "ignore",
        });
      } catch (error) {
        finish({ ok: false, error });
        return;
      }

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void killTree(child, spawnFn).then(
          () => resolveAttempt({ ok: false, timedOut: true }),
          (error) => resolveAttempt({ ok: false, timedOut: true, error }),
        );
      }, installTimeoutMs);
      child.on("error", (error) => finish({ ok: false, error }));
      child.on("exit", (code) => finish({ ok: code === 0, code }));
    });
  }

  async function markInstallComplete(projectDir: string): Promise<void> {
    // The real project directory always exists. Keeping this no-op for a
    // missing directory preserves the spawn seam used by unit tests, where cwd
    // is intentionally synthetic and no filesystem is created.
    if (!existsSync(projectDir)) return;
    await fs.access(resolve(projectDir, "node_modules"));
    await fs.writeFile(installMarkerPath(projectDir), INSTALL_MARKER_CONTENT, "utf8");
  }

  async function hasCompleteInstall(projectDir: string): Promise<boolean> {
    try {
      return (await fs.readFile(installMarkerPath(projectDir), "utf8")) === INSTALL_MARKER_CONTENT;
    } catch {
      return false;
    }
  }

  function formatInstallAttempt(result: InstallAttempt): string {
    if (result.timedOut) return `预览依赖安装超时（${installTimeoutMs / 1000}s）`;
    if (result.error) return "无法执行";
    return `exit ${result.code ?? "killed"}`;
  }

  /**
   * First start needs dependencies: generated projects ship a package.json but no
   * node_modules. Offline pnpm store is preferred; a missing cache falls back to
   * the normal online install. A marker written only after a successful install
   * prevents a partial node_modules tree from being treated as complete.
   * Run pnpm.cjs directly through node (no shell, no .cmd quoting pitfalls).
   */
  async function ensureInstalled(projectDir: string): Promise<void> {
    if (await hasCompleteInstall(projectDir)) return;

    const offlineArgs = ["install", "--offline", "--config.proxy=", "--config.https-proxy="];
    const onlineArgs = ["install", "--config.proxy=", "--config.https-proxy="];
    const offline = await runInstallAttempt(projectDir, offlineArgs);
    if (offline.ok) {
      try {
        await markInstallComplete(projectDir);
        return;
      } catch {
        await clearIncompleteInstall(projectDir);
      }
    } else {
      await clearIncompleteInstall(projectDir);
    }

    const online = await runInstallAttempt(projectDir, onlineArgs);
    if (online.ok) {
      try {
        await markInstallComplete(projectDir);
        return;
      } catch {
        await clearIncompleteInstall(projectDir);
      }
    } else {
      await clearIncompleteInstall(projectDir);
    }

    throw new Error(
      `预览依赖安装失败：离线安装 ${formatInstallAttempt(offline)}；在线回退 ${formatInstallAttempt(online)}` +
        `（请重试打开预览；若反复失败，请在 ${projectDir} 手动执行 pnpm install 后删除此目录下 ${INSTALL_MARKER} 再试）`,
    );
  }

  const nextFreePort = (): number | null => {
    const used = new Set([...running.values()].map((p) => p.entry.port));
    for (let port = PREVIEW_PORT_START; port <= PREVIEW_PORT_END; port++) {
      if (!used.has(port)) return port;
    }
    return null;
  };

  async function start(projectId: string, projectDir: string): Promise<{ port: number }> {
    const existing = running.get(projectId);
    if (existing) return { port: existing.entry.port }; // already running — reuse
    await ensureInstalled(projectDir);
    const port = nextFreePort();
    if (port === null) {
      throw new Error(
        `预览端口段已耗尽（${PREVIEW_PORT_START}-${PREVIEW_PORT_END}）：请先停止部分项目预览`,
      );
    }
    const child = spawnFn(process.execPath, [viteBin, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
      cwd: projectDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await pollUntilReady(child, port, fetchFn, startTimeoutMs, pollIntervalMs);
    } catch (err) {
      child.kill();
      throw err;
    }
    const entry: PreviewEntry = { projectId, port, pid: child.pid ?? -1 };
    running.set(projectId, { entry, child });
    child.on("exit", () => running.delete(projectId));
    return { port };
  }

  async function stop(projectId: string): Promise<void> {
    const proc = running.get(projectId);
    if (!proc) return;
    running.delete(projectId);
    await killTree(proc.child, spawnFn);
  }

  async function shutdownAll(): Promise<void> {
    await Promise.all([...running.keys()].map((id) => stop(id)));
  }

  // One process-level hook for all managers (per-manager listeners would leak).
  liveManagers.add(running);

  return {
    start,
    stop,
    status: () => [...running.values()].map((p) => ({ ...p.entry })),
    shutdownAll,
  };
}

/** Every registry still holding processes at exit gets a best-effort sync kill. */
const liveManagers = new Set<Map<string, ManagedProcess>>();
process.on("exit", () => {
  for (const registry of liveManagers) {
    for (const proc of registry.values()) {
      try {
        proc.child.kill();
      } catch {
        // best effort during shutdown
      }
    }
  }
});
