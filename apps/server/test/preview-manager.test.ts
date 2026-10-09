import { EventEmitter } from "node:events";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import {
  PREVIEW_PORT_END,
  PREVIEW_PORT_START,
  createPreviewManager,
  type FetchFn,
  type SpawnFn,
} from "../src/preview/processes.js";

interface SpawnCall {
  cmd: string;
  args: string[];
  opts: { cwd: string; env: NodeJS.ProcessEnv };
}

/** Fake child: stdout is a real EventEmitter so the probe can emit "Local:". */
function fakeChild(pid: number): ChildProcess & { killed: boolean } {
  const base = new EventEmitter() as unknown as {
    pid: number;
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => boolean;
  };
  base.pid = pid;
  base.killed = false;
  base.stdout = new EventEmitter();
  base.stderr = new EventEmitter();
  base.kill = () => {
    base.killed = true;
    return true;
  };
  return base as unknown as ChildProcess & { killed: boolean };
}

/** Loose spawn mock factory: records calls, hands out fake children.
 *  pnpm install calls always get an immediate-exit-0 child (ensureInstalled resolves). */
function makeSpawnMock(childFactory: (cmd: string) => ChildProcess & { killed: boolean }) {
  const calls: SpawnCall[] = [];
  const impl = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, opts });
    const child = childFactory(cmd);
    const isInstall = cmd === process.execPath && args.some((a) => String(a).includes("pnpm.cjs"));
    if (isInstall) {
      // setTimeout (macrotask) so the ensureInstalled listener is attached first —
      // a microtask would fire before child.on("exit") registers and the promise hangs.
      setTimeout(() => child.emit("exit", 0), 0);
    }
    return child;
  };
  return { calls, spawnFn: vi.fn(impl) as unknown as SpawnFn & { mock: { calls: unknown[][] } } };
}

/** spawn mock: records every call, hands out fake children, fires "Local:" async. */
function makeSpawner() {
  const children: (ChildProcess & { killed: boolean })[] = [];
  const { calls, spawnFn } = makeSpawnMock((cmd: string) => {
    const child = fakeChild(1000 + children.length);
    children.push(child);
    if (cmd.includes("pnpm")) return child; // auto-exit handled by makeSpawnMock
    queueMicrotask(() => child.stdout?.emit("data", "  Local: http://127.0.0.1:5180/"));
    // taskkill children must "finish" so stop()/killTree can resolve
    setTimeout(() => child.emit("close", 0), 0);
    return child;
  });
  return { calls, children, spawnFn };
}

/** vite spawn calls only (excludes pnpm install / taskkill bookkeeping).
 *  Both install and vite run through process.execPath (node); vite is the call
 *  whose first arg targets vite.js. */
function viteCalls(calls: SpawnCall[]): SpawnCall[] {
  return calls.filter(
    (c) => c.cmd === process.execPath && String(c.args[0]).includes("vite"),
  );
}

const neverFetch: FetchFn = () => Promise.reject(new Error("no server"));
const alwaysUp: FetchFn = () => Promise.resolve(new Response("", { status: 200 }));

describe("createPreviewManager", () => {
  it("离线安装失败时在线回退，并在成功后写完成标记", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "studio-preview-install-"));
    const calls: SpawnCall[] = [];
    const spawnFn = vi.fn((cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      const child = fakeChild(700 + calls.length);
      calls.push({ cmd, args, opts });
      const isInstall = cmd === process.execPath && args.some((arg) => String(arg).includes("pnpm.cjs"));
      if (isInstall) {
        const offline = args.includes("--offline");
        // The online exit must land AFTER node_modules exists — markInstallComplete
        // reads it (access) right on exit; an un-awaited mkdir lets access win the
        // race under load and the install is wrongly treated as failed.
        setTimeout(() => {
          if (offline) {
            child.emit("exit", 1);
            return;
          }
          void mkdir(join(projectDir, "node_modules"), { recursive: true }).then(() =>
            child.emit("exit", 0),
          );
        }, 0);
      } else if (cmd === "taskkill") {
        setTimeout(() => child.emit("close", 0), 0);
      } else {
        queueMicrotask(() => child.stdout?.emit("data", "  Local: http://127.0.0.1:5180/"));
      }
      return child;
    }) as unknown as SpawnFn;
    const mgr = createPreviewManager(spawnFn, neverFetch, { pollIntervalMs: 1 });
    try {
      await mgr.start("fallback", projectDir);
      const installs = calls.filter((call) => call.args.includes("install"));
      expect(installs).toHaveLength(2);
      expect(installs[0]?.args).toContain("--offline");
      expect(installs[1]?.args).not.toContain("--offline");
      await expect(access(join(projectDir, "node_modules", ".studio-install-complete"))).resolves.toBeUndefined();
    } finally {
      await mgr.shutdownAll();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("半安装 node_modules 没有完成标记时仍会重新安装", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "studio-preview-partial-"));
    await mkdir(join(projectDir, "node_modules"), { recursive: true });
    const { calls, spawnFn } = makeSpawner();
    const mgr = createPreviewManager(spawnFn, neverFetch, { pollIntervalMs: 1 });
    try {
      await mgr.start("partial", projectDir);
      const installs = calls.filter((call) => call.args.includes("install"));
      expect(installs).toHaveLength(1);
    } finally {
      await mgr.shutdownAll();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("安装超时会先清理进程与残目录，再尝试在线安装", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "studio-preview-timeout-"));
    const calls: SpawnCall[] = [];
    let installAttempt = 0;
    let offlineChild: (ChildProcess & { killed: boolean }) | undefined;
    const spawnFn = vi.fn((cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      const child = fakeChild(750 + calls.length);
      calls.push({ cmd, args, opts });
      const isInstall = cmd === process.execPath && args.some((arg) => String(arg).includes("pnpm.cjs"));
      if (isInstall) {
        installAttempt += 1;
        if (installAttempt === 1) {
          offlineChild = child;
          void mkdir(join(projectDir, "node_modules"), { recursive: true });
          // Leave the offline attempt running until the manager times it out.
        } else {
          void mkdir(join(projectDir, "node_modules"), { recursive: true }).then(() =>
            setTimeout(() => child.emit("exit", 0), 0),
          );
        }
      } else if (cmd === "taskkill") {
        setTimeout(() => child.emit("close", 0), 0);
      } else {
        queueMicrotask(() => child.stdout?.emit("data", "  Local: http://127.0.0.1:5180/"));
      }
      return child;
    }) as unknown as SpawnFn;
    const mgr = createPreviewManager(spawnFn, neverFetch, { installTimeoutMs: 10, pollIntervalMs: 1 });
    try {
      await mgr.start("timeout-fallback", projectDir);
      expect(calls.filter((call) => call.args.includes("install"))).toHaveLength(2);
      if (process.platform !== "win32") expect(offlineChild?.killed).toBe(true);
      await expect(access(join(projectDir, "node_modules", ".studio-install-complete"))).resolves.toBeUndefined();
    } finally {
      await mgr.shutdownAll();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("离线失败与在线超时时清理半安装目录并保留超时信息", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "studio-preview-cleanup-"));
    const calls: SpawnCall[] = [];
    let installAttempt = 0;
    const spawnFn = vi.fn((cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      const child = fakeChild(800 + calls.length);
      calls.push({ cmd, args, opts });
      const isInstall = cmd === process.execPath && args.some((arg) => String(arg).includes("pnpm.cjs"));
      if (isInstall) {
        installAttempt += 1;
        void mkdir(join(projectDir, "node_modules"), { recursive: true })
          .then(() => writeFile(join(projectDir, "node_modules", "partial.txt"), "partial"))
          .then(() => {
            if (installAttempt === 1) setTimeout(() => child.emit("exit", 1), 0);
          });
      } else if (cmd === "taskkill") {
        setTimeout(() => child.emit("close", 0), 0);
      }
      return child;
    }) as unknown as SpawnFn;
    const mgr = createPreviewManager(spawnFn, neverFetch, { installTimeoutMs: 50, pollIntervalMs: 1 });
    try {
      await expect(mgr.start("failed-install", projectDir)).rejects.toThrow(/预览依赖安装超时/);
      expect(calls.filter((call) => call.args.includes("install"))).toHaveLength(2);
      await expect(access(join(projectDir, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await mgr.shutdownAll();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("spawn 参数：node vite bin --port --strictPort，cwd=projectDir，env 带 NO_COLOR", async () => {
    const { calls, spawnFn } = makeSpawner();
    const mgr = createPreviewManager(spawnFn, neverFetch);
    await mgr.start("p1", "D:/proj");
    const vite = viteCalls(calls);
    expect(vite).toHaveLength(1);
    const first = vite[0] as SpawnCall;
    expect(first.cmd).toBe(process.execPath);
    expect(first.args[0]).toContain(join("node_modules", "vite", "bin", "vite.js"));
    expect(first.args).toContain("--strictPort")
    expect(first.args).toContain("--host");
    expect(first.opts.cwd).toBe("D:/proj");
    expect(first.opts.env.NO_COLOR).toBe("1");
    expect(first.args).toContain(String(PREVIEW_PORT_START));
    // first start also installs dependencies (node pnpm.cjs install)
    expect(calls.some((c) => c.args.some((a) => String(a).includes("pnpm.cjs")) && c.args.includes("install"))).toBe(true);
  });

  it("两个项目端口顺延（5180、5181）；同项目复用同端口不再 spawn", async () => {
    const { calls, spawnFn } = makeSpawner();
    const mgr = createPreviewManager(spawnFn, neverFetch);
    const a = await mgr.start("a", "D:/a");
    const b = await mgr.start("b", "D:/b");
    expect(a.port).toBe(PREVIEW_PORT_START);
    expect(b.port).toBe(PREVIEW_PORT_START + 1);
    expect(viteCalls(calls)).toHaveLength(2);

    const again = await mgr.start("a", "D:/a"); // reuse: no new spawn
    expect(again.port).toBe(PREVIEW_PORT_START);
    expect(viteCalls(calls)).toHaveLength(2);

    expect(mgr.status().map((s) => s.projectId)).toEqual(["a", "b"]);
    expect(mgr.status()[0]?.pid).toBe(1001); // pnpm child took pid 1000
  });

  it("stop 后端口释放可复用；未运行项目 stop 为 no-op", async () => {
    const { calls, children, spawnFn } = makeSpawner();
    const mgr = createPreviewManager(spawnFn, neverFetch);
    await mgr.start("a", "D:/a");
    await mgr.stop("a");
    expect(mgr.status()).toHaveLength(0);
    await mgr.stop("ghost"); // no throw

    const c = await mgr.start("c", "D:/c"); // freed port reused
    expect(c.port).toBe(PREVIEW_PORT_START);
    // vite launches only (excludes pnpm install and taskkill bookkeeping)
    expect(viteCalls(calls)).toHaveLength(2);
    // child exit event also clears the registry entry (children[1] = vite child of "a")
    children[1]?.emit("exit", 1);
    expect(mgr.status().map((s) => s.projectId)).toEqual(["c"]);
  });

  it("stop 在 Windows 走 taskkill /PID <pid> /T /F；非 Windows 直接 kill", async () => {
    const { spawnFn } = makeSpawner();
    const mgr = createPreviewManager(spawnFn, neverFetch);
    await mgr.start("a", "D:/a");
    const pid = mgr.status()[0]?.pid;
    await mgr.stop("a");
    const killCall = spawnFn.mock.calls.find((argsArr) => (argsArr as unknown[])[0] === "taskkill");
    if (process.platform === "win32") {
      expect(killCall).toBeDefined();
      expect((killCall as unknown[])[1]).toEqual(["/PID", String(pid), "/T", "/F"]);
    } else {
      expect(killCall).toBeUndefined();
    }
  });

  it("fetch 探活路径：stdout 不出现 Local: 时用 fetch 判定就绪", async () => {
    let n = 0;
    const spawnFn = makeSpawnMock(() => fakeChild(42)).spawnFn;
    const fetchProbe = vi.fn(() => {
      n += 1;
      return n < 3 ? Promise.reject(new Error("refused")) : Promise.resolve(new Response("", { status: 200 }));
    }) as unknown as FetchFn;
    const mgr = createPreviewManager(spawnFn, fetchProbe, { pollIntervalMs: 5 });
    const { port } = await mgr.start("a", "D:/a");
    expect(port).toBe(PREVIEW_PORT_START);
    expect(fetchProbe).toHaveBeenCalled();
  });

  it("启动超时：报错并 kill 子进程，不进注册表", async () => {
    let spawned: ChildProcess & { killed: boolean } | undefined;
    const spawnFn = makeSpawnMock(() => {
      spawned = fakeChild(7);
      return spawned;
    }).spawnFn;
    const mgr = createPreviewManager(spawnFn, neverFetch, {
      startTimeoutMs: 20,
      pollIntervalMs: 5,
    });
    await expect(mgr.start("a", "D:/a")).rejects.toThrow(/预览进程启动超时/);
    expect(mgr.status()).toHaveLength(0);
    expect(spawned?.killed).toBe(true);
  });

  it("端口段耗尽报错", async () => {
    const spawnFn = makeSpawnMock(() => fakeChild(7)).spawnFn;
    const mgr = createPreviewManager(spawnFn, alwaysUp, { pollIntervalMs: 1 });
    const capacity = PREVIEW_PORT_END - PREVIEW_PORT_START + 1;
    for (let i = 0; i < capacity; i++) {
      await mgr.start(`p${i}`, "D:/x");
    }
    await expect(mgr.start("overflow", "D:/x")).rejects.toThrow(/端口段已耗尽/);
  });

  it("shutdownAll 清空注册表", async () => {
    const { spawnFn } = makeSpawner();
    const mgr = createPreviewManager(spawnFn, neverFetch);
    await mgr.start("a", "D:/a");
    await mgr.start("b", "D:/b");
    await mgr.shutdownAll();
    expect(mgr.status()).toHaveLength(0);
  });
});
