import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import {
  PREVIEW_PORT_START,
  createPreviewManager,
  type FetchFn,
  type SpawnFn,
} from "../src/preview/processes.js";

/**
 * U4 — preview install defense (p0-batch1 §3.4/§5-U4).
 *
 * Locks the marker timeline contract (§9-Q5): the completion marker
 * `.studio-install-complete` is written ONLY after a successful install, so
 * "marker present + half-installed node_modules" is unreachable. Three cases:
 * install failure leaves no marker and the error carries retry guidance; a
 * retried start re-runs install and writes the marker on success; an existing
 * marker skips install entirely.
 */

const neverFetch: FetchFn = () => Promise.reject(new Error("no server"));

interface SpawnCall {
  cmd: string;
  args: string[];
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

type InstallMode = "fail" | "succeed";

/** pnpm install children follow the mutable mode; vite children emit "Local:".
 *  On success node_modules is created BEFORE exit-0 — markInstallComplete
 *  accesses it right on exit (same race guard as preview-manager.test.ts). */
function makeSpawn(projectDir: string, mode: () => InstallMode) {
  const calls: SpawnCall[] = [];
  const installCalls = (): SpawnCall[] =>
    calls.filter((c) => c.cmd === process.execPath && c.args.includes("install"));
  const spawnFn = vi.fn((cmd: string, args: string[], _opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
    const child = fakeChild(900 + calls.length);
    calls.push({ cmd, args: [...args] });
    const isInstall = cmd === process.execPath && args.some((a) => String(a).includes("pnpm.cjs"));
    if (isInstall) {
      setTimeout(() => {
        if (mode() === "fail") {
          child.emit("exit", 1);
          return;
        }
        void mkdir(join(projectDir, "node_modules"), { recursive: true }).then(() => child.emit("exit", 0));
      }, 0);
    } else if (cmd === "taskkill") {
      setTimeout(() => child.emit("close", 0), 0);
    } else {
      queueMicrotask(() => child.stdout?.emit("data", "  Local: http://127.0.0.1:5180/"));
    }
    return child;
  }) as unknown as SpawnFn;
  return { installCalls, spawnFn };
}

async function withTempDir(run: (projectDir: string) => Promise<void>): Promise<void> {
  const projectDir = await mkdtemp(join(tmpdir(), "studio-preview-u4-"));
  try {
    await run(projectDir);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
}

describe("preview install 防御（U4）", () => {
  it("install 失败：目录无完成标记，错误消息含手动修复指引", async () => {
    await withTempDir(async (projectDir) => {
      const { installCalls, spawnFn } = makeSpawn(projectDir, () => "fail");
      const mgr = createPreviewManager(spawnFn, neverFetch, { pollIntervalMs: 1 });
      const err: Error = await mgr.start("u4a", projectDir).then(
        () => {
          throw new Error("start should have rejected");
        },
        (e: unknown) => e as Error,
      );
      expect(err.message).toContain("预览依赖安装失败");
      expect(err.message).toContain("请重试打开预览");
      expect(err.message).toContain(`请在 ${projectDir} 手动执行 pnpm install`);
      expect(err.message).toContain(".studio-install-complete");
      // offline + online both attempted, then cleaned up — no marker anywhere
      expect(installCalls()).toHaveLength(2);
      await expect(
        access(join(projectDir, "node_modules", ".studio-install-complete")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("第二次 start：install 重试，成功后写入完成标记", async () => {
    await withTempDir(async (projectDir) => {
      let mode: InstallMode = "fail";
      const { installCalls, spawnFn } = makeSpawn(projectDir, () => mode);
      const mgr = createPreviewManager(spawnFn, neverFetch, { pollIntervalMs: 1 });
      await expect(mgr.start("u4b", projectDir)).rejects.toThrow(/预览依赖安装失败/);
      expect(installCalls()).toHaveLength(2); // offline + online, both failed

      mode = "succeed";
      const { port } = await mgr.start("u4b", projectDir);
      expect(port).toBe(PREVIEW_PORT_START);
      expect(installCalls()).toHaveLength(3); // retried once more (offline succeeds)
      expect(installCalls()[2]?.args).toContain("--offline");
      await expect(
        access(join(projectDir, "node_modules", ".studio-install-complete")),
      ).resolves.toBeUndefined();
    });
  });

  it("标记已存在：跳过 install，直接启动 vite（意外 install 会失败暴露）", async () => {
    await withTempDir(async (projectDir) => {
      await mkdir(join(projectDir, "node_modules"), { recursive: true });
      await writeFile(join(projectDir, "node_modules", ".studio-install-complete"), "ok\n", "utf8");
      // "fail" mode makes any accidental install attempt blow up the start call
      const { installCalls, spawnFn } = makeSpawn(projectDir, () => "fail");
      const mgr = createPreviewManager(spawnFn, neverFetch, { pollIntervalMs: 1 });
      const { port } = await mgr.start("u4c", projectDir);
      expect(port).toBe(PREVIEW_PORT_START);
      expect(installCalls()).toHaveLength(0);
    });
  });
});
