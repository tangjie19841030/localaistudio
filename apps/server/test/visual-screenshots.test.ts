import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathError } from "../src/store/projects.js";
import {
  ISSUES_FILE,
  assertSafeRunId,
  assertSafeShotFile,
  issuesFile,
  runDir,
  snapshotsDir,
} from "../src/visual/paths.js";
import {
  listVisualRuns,
  installLocalOnlyGuard,
  isLocalBrowserUrl,
  runVisualCheck,
  type ScreenshotRunner,
} from "../src/visual/screenshots.js";
import { fakeRunner, RUN_ID_A, RUN_ID_B, writeRunFixture } from "./visual-fixtures.js";

const UUID = "11111111-2222-4333-8444-555555555555";

let projectDir: string;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(join(tmpdir(), "studio-visual-"));
});

afterEach(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe("visual/paths", () => {
  it("snapshotsDir / runDir / issuesFile 拼在 design/snapshots 下", () => {
    expect(snapshotsDir("/p")).toBe(join("/p", "design", "snapshots"));
    expect(runDir("/p", UUID)).toBe(join("/p", "design", "snapshots", UUID));
    expect(issuesFile("/p", UUID)).toBe(join("/p", "design", "snapshots", UUID, ISSUES_FILE));
  });

  it("assertSafeRunId 只放行 UUID，穿越串抛 PathError", () => {
    expect(assertSafeRunId(UUID)).toBe(UUID);
    for (const bad of ["", "..", "../../etc", "not-a-uuid", `${UUID}/x`, `${UUID}.json`]) {
      expect(() => assertSafeRunId(bad)).toThrow(PathError);
    }
  });

  it("assertSafeShotFile 只放行三个视口 PNG 名", () => {
    for (const ok of ["desktop.png", "tablet.png", "mobile.png"]) {
      expect(assertSafeShotFile(ok)).toBe(ok);
    }
    for (const bad of ["issues.json", "desktop.PNG", "desk.png", "../desktop.png", "desktop.png.txt", ""]) {
      expect(() => assertSafeShotFile(bad)).toThrow(PathError);
    }
  });

  it("runDir 对非法 runId 立刻抛，不产生任何路径", () => {
    expect(() => runDir("/p", "../evil")).toThrow(PathError);
  });
});

describe("runVisualCheck", () => {
  it("落盘 snapshots/<runId>/ 三张 PNG + issues.json，内容与返回一致", async () => {
    const runner = fakeRunner();
    const result = await runVisualCheck(projectDir, "http://127.0.0.1:5180", runner.run);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.url).toBe("http://127.0.0.1:5180");
    expect(runner.calls[0]!.outDir).toBe(runDir(projectDir, result.runId));

    const dir = runDir(projectDir, result.runId);
    const entries = (await fs.readdir(dir)).sort();
    expect(entries).toEqual(["desktop.png", "issues.json", "mobile.png", "tablet.png"]);
    // real PNG magic bytes, not an empty placeholder
    const png = await fs.readFile(join(dir, "desktop.png"));
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const onDisk = JSON.parse(await fs.readFile(join(dir, ISSUES_FILE), "utf8")) as typeof result;
    expect(onDisk).toEqual(result);
    expect(onDisk.runId).toBe(result.runId);
    expect(onDisk.shots.map((s) => s.viewport)).toEqual(["desktop", "tablet", "mobile"]);
  });

  it("审计走 schema-core 纯函数：溢出/截断/控制台错误都进 summary", async () => {
    const result = await runVisualCheck(projectDir, "http://127.0.0.1:5180", fakeRunner().run);
    expect(result.summary.byKind["horizontal-overflow"]).toBe(1);
    expect(result.summary.byKind["text-truncation"]).toBe(1);
    expect(result.summary.byKind["console-error"]).toBe(1);
    expect(result.summary.errorCount).toBe(2);
    expect(result.summary.warnCount).toBe(1);
    expect(result.summary.total).toBe(3);
    expect(result.issues.map((i) => i.kind).sort()).toEqual([
      "console-error",
      "horizontal-overflow",
      "text-truncation",
    ]);
    // studioId 透传：截断问题能映射回 Schema 节点
    const truncation = result.issues.find((i) => i.kind === "text-truncation");
    expect(truncation?.studioIds).toEqual(["node-title"]);
  });

  it("两次运行产生不同 runId 且互不覆盖", async () => {
    const a = await runVisualCheck(projectDir, "http://127.0.0.1:5180", fakeRunner().run);
    const b = await runVisualCheck(projectDir, "http://127.0.0.1:5180", fakeRunner().run);
    expect(a.runId).not.toBe(b.runId);
    expect((await fs.readdir(snapshotsDir(projectDir))).sort()).toEqual([a.runId, b.runId].sort());
  });

  it("runner 抛错时向上冒泡（不写 issues.json）", async () => {
    const boom: ScreenshotRunner = async () => {
      throw new Error("浏览器启动失败");
    };
    await expect(runVisualCheck(projectDir, "http://127.0.0.1:5180", boom)).rejects.toThrow(
      "浏览器启动失败",
    );
    const dirs = await fs.readdir(snapshotsDir(projectDir));
    expect(dirs).toHaveLength(1);
    expect(await fs.readdir(join(snapshotsDir(projectDir), dirs[0]!))).toEqual([]);
  });
});

describe("listVisualRuns", () => {
  it("无 snapshots 目录返回空数组", async () => {
    expect(await listVisualRuns(projectDir)).toEqual([]);
  });

  it("createdAt 倒序", async () => {
    await writeRunFixture(projectDir, RUN_ID_A, "2026-01-01T00:00:00.000Z");
    await writeRunFixture(projectDir, RUN_ID_B, "2026-06-01T00:00:00.000Z");
    const runs = await listVisualRuns(projectDir);
    expect(runs.map((r) => r.runId)).toEqual([RUN_ID_B, RUN_ID_A]);
  });

  it("坏 issues.json 被跳过而不炸；缺 issues.json 的目录也跳过", async () => {
    await writeRunFixture(projectDir, RUN_ID_A, "2026-01-01T00:00:00.000Z");
    const badDir = join(snapshotsDir(projectDir), RUN_ID_B);
    await fs.mkdir(badDir, { recursive: true });
    await fs.writeFile(join(badDir, ISSUES_FILE), "{ not json", "utf8");
    await fs.mkdir(join(snapshotsDir(projectDir), "orphan"), { recursive: true });

    const runs = await listVisualRuns(projectDir);
    expect(runs.map((r) => r.runId)).toEqual([RUN_ID_A]);
  });
});

describe("isLocalBrowserUrl（local-only 网络护栏，T24c §4.4）", () => {
  it("放行 127.0.0.1 / localhost / [::1] 的 http(s)", () => {
    for (const url of [
      "http://127.0.0.1:5180",
      "http://127.0.0.1",
      "https://127.0.0.1:5180",
      "http://localhost:5180",
      "https://localhost",
      "http://[::1]:5180",
    ]) {
      expect(isLocalBrowserUrl(url)).toBe(true);
    }
  });

  it("放行 data: / blob: / about: 伪协议", () => {
    for (const url of [
      "data:image/png;base64,AAAA",
      "blob:http://localhost:5180/uuid",
      "about:blank",
    ]) {
      expect(isLocalBrowserUrl(url)).toBe(true);
    }
  });

  it("拦截公网 host（含公网 localhost 解析的不安全示例）", () => {
    for (const url of [
      "http://example.com",
      "https://cdn.example.com/x.png",
      "http://127.0.0.1.evil.com/",
      "http://10.0.0.1:5180", // 局域网段也属"非本地"
      "ws://localhost:5180", // 协议不对
    ]) {
      expect(isLocalBrowserUrl(url)).toBe(false);
    }
  });

  it("拦截 file: / 空串 / 非 URL 字符串", () => {
    for (const url of ["file:///C:/x.png", "", "not a url"]) {
      expect(isLocalBrowserUrl(url)).toBe(false);
    }
  });
});

interface FakeRoute {
  url: string;
  continueCalls: number;
  abortCalls: number;
  abortReason?: string;
}

/**
 * Tiny BrowserContext double: every installed route handler is remembered and
 * can be invoked with a synthetic request URL. Lets us assert that local URLs
 * are continued and external URLs are aborted, without touching Playwright.
 */
type FakeRouteObject = {
  request: () => { url: () => string };
  continue: () => Promise<void>;
  abort: (reason?: string) => Promise<void>;
};

function fakeContext() {
  const handlers: ((route: FakeRouteObject) => void)[] = [];
  return {
    async route(_pattern: string, handler: (route: unknown) => void): Promise<void> {
      handlers.push(handler as unknown as (route: FakeRouteObject) => void);
    },
    async invoke(url: string): Promise<FakeRoute> {
      const record: FakeRoute = { url, continueCalls: 0, abortCalls: 0 };
      const request = { url: () => url };
      const route = {
        request: () => request,
        continue: async () => {
          record.continueCalls += 1;
        },
        abort: async (reason?: string) => {
          record.abortCalls += 1;
          record.abortReason = reason;
        },
      };
      for (const h of handlers) {
        await h(route);
      }
      return record;
    },
  };
}

describe("installLocalOnlyGuard（Playwright 路由护栏）", () => {
  it("loopback URL 被 continue；公网 URL 被 abort blockedbyclient", async () => {
    const ctx = fakeContext();
    await installLocalOnlyGuard(ctx as unknown as import("playwright-core").BrowserContext);
    const local = await ctx.invoke("http://127.0.0.1:5180/main.js");
    expect(local.continueCalls).toBe(1);
    expect(local.abortCalls).toBe(0);
    const external = await ctx.invoke("https://cdn.example.com/x.png");
    expect(external.continueCalls).toBe(0);
    expect(external.abortCalls).toBe(1);
    expect(external.abortReason).toBe("blockedbyclient");
  });

  it("data: / blob: / about: 被 continue；file: 被 abort", async () => {
    const ctx = fakeContext();
    await installLocalOnlyGuard(ctx as unknown as import("playwright-core").BrowserContext);
    for (const ok of ["data:image/png;base64,AAAA", "blob:http://localhost/uuid", "about:blank"]) {
      const r = await ctx.invoke(ok);
      expect(r.continueCalls).toBe(1);
      expect(r.abortCalls).toBe(0);
    }
    const fileBlocked = await ctx.invoke("file:///C:/secret");
    expect(fileBlocked.abortCalls).toBe(1);
  });
});
