import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectBundle } from "../src/store/projects.js";
import { exportZip, runChecks, type CheckRunner } from "../src/codegen/export.js";

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-export-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

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

describe("exportZip", () => {
  it("打包项目文件并排除 node_modules/.vite/dist", async () => {
    const dir = join(baseDir, "p1");
    await fs.mkdir(join(dir, "src", "pages"), { recursive: true });
    await fs.writeFile(join(dir, "package.json"), "{}", "utf8");
    await fs.writeFile(join(dir, "src", "pages", "Home.tsx"), "export {}", "utf8");
    await fs.mkdir(join(dir, "node_modules", "react"), { recursive: true });
    await fs.writeFile(join(dir, "node_modules", "react", "index.js"), "junk", "utf8");
    await fs.mkdir(join(dir, "dist"), { recursive: true });
    await fs.writeFile(join(dir, "dist", "bundle.js"), "built", "utf8");
    await fs.mkdir(join(dir, ".vite"), { recursive: true });
    await fs.writeFile(join(dir, ".vite", "cache.json"), "cache", "utf8");

    const buf = await exportZip(dir);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toEqual(["package.json", "src/pages/Home.tsx"]);
    expect(await zip.file("src/pages/Home.tsx")!.async("string")).toBe("export {}");
  });

  it("空项目目录产出空 zip", async () => {
    const dir = join(baseDir, "empty");
    await fs.mkdir(dir, { recursive: true });
    const zip = await JSZip.loadAsync(await exportZip(dir));
    expect(Object.keys(zip.files)).toHaveLength(0);
  });
});

/** Fake runner recording the executed sequence with scripted results. */
function fakeRunner(results: Record<string, { code: number | null; output: string }>) {
  const calls: { cmd: string; args: string[]; cwd: string }[] = [];
  const runner = vi.fn(async (spec: { cmd: string; args: string[]; label: string }, cwd: string) => {
    calls.push({ cmd: spec.cmd, args: spec.args, cwd });
    return results[spec.label] ?? { code: 0, output: "" };
  }) as unknown as CheckRunner & { mock: { calls: { label: string }[] } };
  return { calls, runner };
}

describe("runChecks", () => {
  it("已装依赖时跳过 install，依次执行 tsc 与 vite build，全过 ok", async () => {
    const dir = join(baseDir, "ok-proj");
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(join(dir, "node_modules"), { recursive: true }); // marks installed
    const { calls, runner } = fakeRunner({});
    const result = await runChecks(dir, { runner });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(calls.map((c) => c.args.join(" "))).toEqual([
      "exec tsc --noEmit",
      "exec vite build",
    ]);
    expect(calls.every((c) => c.cwd === dir)).toBe(true);
  });

  it("未装依赖时先执行 pnpm install --offline；失败继续收集后续错误", async () => {
    const dir = join(baseDir, "bad-proj");
    await fs.mkdir(dir, { recursive: true });
    const { calls, runner } = fakeRunner({
      "pnpm install --offline": { code: 1, output: "ERR_PNPM" },
      "tsc --noEmit": { code: 0, output: "" },
      "vite build": { code: 2, output: "Build failed" },
    });
    const result = await runChecks(dir, { runner });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("pnpm install --offline 失败");
    expect(result.errors[0]).toContain("ERR_PNPM");
    expect(result.errors[1]).toContain("vite build 失败");
    expect(result.errors[1]).toContain("Build failed");
    expect(calls).toHaveLength(3); // every step still ran
  });

  it("runner 抛错（如 tsc 不存在）记为该步骤无法执行且不中断", async () => {
    const dir = join(baseDir, "no-tsc");
    await fs.mkdir(dir, { recursive: true });
    const runner = vi.fn(async (spec: { label: string }) => {
      if (spec.label === "tsc --noEmit") throw new Error("spawn ENOENT");
      return { code: 0, output: "" };
    }) as unknown as CheckRunner;
    const result = await runChecks(dir, { runner, skipInstall: true });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("tsc --noEmit 无法执行");
    expect(result.errors[0]).toContain("spawn ENOENT");
  });

  it("isInstalled 注入：返回 false 时即便目录有 node_modules 也跑 install", async () => {
    const dir = join(baseDir, "stub");
    await fs.mkdir(join(dir, "node_modules"), { recursive: true });
    const { calls, runner } = fakeRunner({});
    const result = await runChecks(dir, {
      runner,
      isInstalled: async () => false,
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.args).toContain("install");
  });

  it("总时限耗尽：剩余步骤记跳过且 ok=false", async () => {
    const dir = join(baseDir, "slow");
    await fs.mkdir(dir, { recursive: true });
    const { runner } = fakeRunner({});
    const result = await runChecks(dir, { runner, skipInstall: true, timeoutMs: -1 });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors[0]).toContain("tsc --noEmit 跳过");
  });
});

describe("POST /api/projects/:id/checks", () => {
  it("返回注入 runner 的检查结果；未知 id 404", async () => {
    const { runner } = fakeRunner({ "vite build": { code: 1, output: "boom" } });
    const app = createApp(createProjectsStore(baseDir), {
      checkRunner: runner,
      skipInstall: true,
    });
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/checks`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: { ok: boolean; errors: string[] } };
    expect(body.checks.ok).toBe(false);
    expect(body.checks.errors[0]).toContain("vite build 失败");

    expect(
      (await app.request("/api/projects/00000000-0000-4000-8000-000000000000/checks", { method: "POST" }))
        .status,
    ).toBe(404);
  });
});

describe("POST /api/projects/:id/export", () => {
  it("返回 zip 二进制流与下载头", async () => {
    const app = createApp(createProjectsStore(baseDir));
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/export`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    // 中文项目名无 ASCII 字符 → filename 回退到项目 id
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${bundle.meta.id}.zip"`,
    );
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    // store 产物（project.json / document/document.json）随项目目录一并打包（P7.2 V2 布局）
    expect(Object.keys(zip.files)).toContain("document/document.json");
    expect(Object.keys(zip.files)).toContain("project.json");
  });

  it("ASCII 项目名进 filename slug", async () => {
    const app = createApp(createProjectsStore(baseDir));
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "My Dashboard 01",
        productType: "后台",
        targetUsers: "运营",
        goal: "g",
        referenceLinks: [],
        brandRules: "",
      }),
    });
    const bundle = (await res.json()) as ProjectBundle;
    const out = await app.request(`/api/projects/${bundle.meta.id}/export`, { method: "POST" });
    expect(out.headers.get("Content-Disposition")).toBe(
      `attachment; filename="My-Dashboard-01.zip"`,
    );
  });

  it("未知项目 404", async () => {
    const app = createApp(createProjectsStore(baseDir));
    expect(
      (await app.request("/api/projects/00000000-0000-4000-8000-000000000000/export", { method: "POST" }))
        .status,
    ).toBe(404);
  });
});
