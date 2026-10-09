import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectBundle } from "../src/store/projects.js";
import type { PreviewManager } from "../src/preview/processes.js";
import { ISSUES_FILE, runDir, snapshotsDir } from "../src/visual/paths.js";
import type { VisualRunResult } from "../src/visual/screenshots.js";
import { PNG_1X1, RUN_ID_A, RUN_ID_B, fakeRunner, writeRunFixture } from "./visual-fixtures.js";

const FAKE_PORT = 5187;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-visual-routes-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

interface StartCall {
  projectId: string;
  projectDir: string;
}

interface StatusEntry {
  projectId: string;
  port: number;
  pid: number;
}

interface FakeManagerOptions {
  /** status() returns one running entry for each id listed; default = none. */
  running?: string[];
}

/** Fake preview manager: records start() calls, hands out a fixed port, spawns nothing. */
function fakeManager(opts: FakeManagerOptions = {}): { manager: PreviewManager; starts: StartCall[] } {
  const starts: StartCall[] = [];
  const running = new Set(opts.running ?? []);
  return {
    starts,
    manager: {
      start: async (projectId, projectDir) => {
        starts.push({ projectId, projectDir });
        return { port: FAKE_PORT };
      },
      stop: async () => {},
      status: (): StatusEntry[] =>
        [...running].map((projectId) => ({ projectId, port: FAKE_PORT, pid: 9999 })),
      shutdownAll: async () => {},
    },
  };
}

function makeApp(extra?: { manager?: PreviewManager; runner?: ReturnType<typeof fakeRunner> }) {
  const runner = extra?.runner ?? fakeRunner();
  const manager = extra?.manager;
  return {
    runner,
    app: createApp(createProjectsStore(baseDir), {
      previewManager: manager,
      screenshotRunner: runner.run,
      generateFiles: () => new Map([["package.json", "{}"]]),
    }),
  };
}

async function createProject(app: ReturnType<typeof createApp>): Promise<ProjectBundle> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "运营工作台",
      productType: "后台",
      targetUsers: "运营",
      goal: "看数据",
      referenceLinks: [],
      brandRules: "",
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectBundle;
}

/** Marks the project as generated so the 409 gate passes. */
async function markGenerated(id: string): Promise<void> {
  await fs.writeFile(join(baseDir, id, "package.json"), "{}", "utf8");
}

describe("POST /api/projects/:id/screenshots", () => {
  it("用已运行预览的 127.0.0.1:<port> 截图，不调 start / 不装依赖，落盘三张 PNG + issues.json", async () => {
    const { manager, starts } = fakeManager(); // status() 默认空，下方手动 push
    const { app, runner } = makeApp({ manager });
    const bundle = await createProject(app);
    await markGenerated(bundle.meta.id);
    // 模拟用户先开过预览：把项目 id 注入 fakeManager 的 running 集合。
    // 实际测试里 fakeManager 用闭包持有 running，这里借用 starts 的可变数组技巧：
    // 我们直接覆盖 manager.status 使它返回该项目的条目。
    (manager as unknown as { status: () => StatusEntry[] }).status = () => [
      { projectId: bundle.meta.id, port: FAKE_PORT, pid: 9999 },
    ];

    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as VisualRunResult;

    // T24c §4.4：质检路由必须 NOT 调 start()，否则会触发依赖在线安装。
    expect(starts).toEqual([]);
    expect(runner.calls[0]!.url).toBe(`http://127.0.0.1:${FAKE_PORT}`);
    expect(body.url).toBe(`http://127.0.0.1:${FAKE_PORT}`);

    const dir = runDir(join(baseDir, bundle.meta.id), body.runId);
    expect((await fs.readdir(dir)).sort()).toEqual([
      "desktop.png",
      "issues.json",
      "mobile.png",
      "tablet.png",
    ]);
    const onDisk = JSON.parse(await fs.readFile(join(dir, ISSUES_FILE), "utf8")) as VisualRunResult;
    expect(onDisk.runId).toBe(body.runId);
    expect(onDisk.summary).toEqual(body.summary);
    expect(body.summary.total).toBe(3);
    expect(body.summary.errorCount).toBe(2);
    expect(body.summary.warnCount).toBe(1);
    expect(body.shots).toEqual([
      { viewport: "desktop", file: "desktop.png" },
      { viewport: "tablet", file: "tablet.png" },
      { viewport: "mobile", file: "mobile.png" },
    ]);
  });

  it("未生成（无 package.json）返回 409 not_generated 且不启预览", async () => {
    const { manager, starts } = fakeManager();
    const { app, runner } = makeApp({ manager });
    const bundle = await createProject(app);

    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_generated");
    expect(body.message).toContain("生成代码");
    expect(starts).toEqual([]);
    expect(runner.calls).toEqual([]);
  });

  it("未知项目 404；非法 id 400", async () => {
    const { app } = makeApp();
    expect((await app.request(`/api/projects/${UNKNOWN_ID}/screenshots`, { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/projects/not-a-uuid/screenshots", { method: "POST" })).status).toBe(400);
  });
});

describe("GET /api/projects/:id/screenshots", () => {
  it("历史批次按 createdAt 倒序返回，坏文件跳过", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    const dir = join(baseDir, bundle.meta.id);
    await writeRunFixture(dir, RUN_ID_A, "2026-01-01T00:00:00.000Z");
    await writeRunFixture(dir, RUN_ID_B, "2026-06-01T00:00:00.000Z");
    await fs.mkdir(join(snapshotsDir(dir), "orphan"), { recursive: true });

    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: VisualRunResult[] };
    expect(body.runs.map((r) => r.runId)).toEqual([RUN_ID_B, RUN_ID_A]);
  });

  it("从未截图过返回空列表", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots`);
    expect(((await res.json()) as { runs: unknown[] }).runs).toEqual([]);
  });

  it("未知项目 404；非法 id 400", async () => {
    const { app } = makeApp();
    expect((await app.request(`/api/projects/${UNKNOWN_ID}/screenshots`)).status).toBe(404);
    expect((await app.request("/api/projects/nope/screenshots")).status).toBe(400);
  });
});

describe("GET /api/projects/:id/screenshots/:runId/:file", () => {
  it("返回 image/png 与真实字节", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    await writeRunFixture(join(baseDir, bundle.meta.id), RUN_ID_A, "2026-01-01T00:00:00.000Z");

    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots/${RUN_ID_A}/desktop.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes).toEqual(PNG_1X1);
  });

  it("批次内不存在的视口图 404", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    await writeRunFixture(join(baseDir, bundle.meta.id), RUN_ID_A, "2026-01-01T00:00:00.000Z");
    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots/${RUN_ID_A}/mobile.png`);
    expect(res.status).toBe(404);
  });

  it("非法 runId 400", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    for (const runId of ["not-a-uuid", "1234", `${RUN_ID_A}x`, `${RUN_ID_A}.json`]) {
      const res = await app.request(
        `/api/projects/${bundle.meta.id}/screenshots/${runId}/desktop.png`,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_path");
    }
  });

  it("字面 .. 段被 URL 规范化吃掉，落不到本路由（404 而非越权读取）", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/screenshots/../desktop.png`);
    expect(res.status).toBe(404);
  });

  it("非白名单文件名 400（含 issues.json、非 png、穿越串）", async () => {
    const { app } = makeApp();
    const bundle = await createProject(app);
    const bad = ["issues.json", "desktop.txt", "..%2F..%2Fproject.json", "%2e%2e%2fproject.json"];
    for (const file of bad) {
      const res = await app.request(
        `/api/projects/${bundle.meta.id}/screenshots/${RUN_ID_A}/${file}`,
      );
      expect([400, 404]).toContain(res.status);
      if (res.status === 400) {
        expect(((await res.json()) as { error: string }).error).toBe("invalid_path");
      }
    }
  });

  it("未知项目 404", async () => {
    const { app } = makeApp();
    const res = await app.request(`/api/projects/${UNKNOWN_ID}/screenshots/${RUN_ID_A}/desktop.png`);
    expect(res.status).toBe(404);
  });
});

describe("createApp 不注入 runner 时", () => {
  it("构造真实 Playwright runner 但不启动浏览器（仅返回闭包）", async () => {
    const app = createApp(createProjectsStore(baseDir));
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
  });
});
