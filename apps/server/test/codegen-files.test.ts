import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStudioDocument, type StudioDocument } from "@studio/schema-core";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectBundle } from "../src/store/projects.js";
import { readKitSources } from "../src/codegen/kit.js";
import { writeGeneratedFiles } from "../src/codegen/files.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-codegen-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

/** Stub generator: deterministic file tree independent of P3-1 progress. */
function stubGenerateFiles(
  doc: StudioDocument,
  _kitSources: Map<string, string>,
): Map<string, string> {
  return new Map([
    ["src/main.tsx", "export {}"],
    ["src/pages/Home.tsx", `// ${doc.name}`],
    ["package.json", JSON.stringify({ name: "gen", private: true })],
  ]);
}

function makeApp() {
  return createApp(createProjectsStore(baseDir), { generateFiles: stubGenerateFiles });
}

async function createProject(app: ReturnType<typeof makeApp>): Promise<ProjectBundle> {
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

describe("readKitSources", () => {
  it("读真实 ui-kit 源码 + tokens；缺失 type 收集警告并跳过", async () => {
    const { sources, warnings } = await readKitSources(["Button", "NoSuchType"]);
    expect(sources.get("tokens")).toContain("tokensToCssVars");
    expect(sources.get("Button")).toContain("Button");
    expect(sources.has("NoSuchType")).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("NoSuchType");
  });
});

describe("writeGeneratedFiles", () => {
  it("落盘返回排序清单；重复生成覆盖 src 且保留 custom/", async () => {
    const dir = join(baseDir, "proj-a");
    await fs.mkdir(join(dir, "src", "components", "custom"), { recursive: true });
    await fs.writeFile(join(dir, "src", "components", "custom", "MyWidget.tsx"), "// custom", "utf8");
    await fs.mkdir(join(dir, "src", "old"), { recursive: true });
    await fs.writeFile(join(dir, "src", "old", "stale.tsx"), "// stale", "utf8");

    const first = await writeGeneratedFiles(dir, defaultStudioDocument("A"), {
      generateFiles: stubGenerateFiles,
    });
    expect(first.written).toEqual(["package.json", "src/main.tsx", "src/pages/Home.tsx"]);
    expect(first.handEdited).toEqual([]);

    // stale generated file gone, custom kept
    expect(await fs.readFile(join(dir, "src", "components", "custom", "MyWidget.tsx"), "utf8")).toBe("// custom");
    await expect(fs.access(join(dir, "src", "old", "stale.tsx"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(join(dir, "package.json"), "utf8")).toContain("gen");

    // regenerate overwrites src content
    await fs.writeFile(join(dir, "src", "main.tsx"), "// hand edited", "utf8");
    const second = await writeGeneratedFiles(dir, defaultStudioDocument("A"), { generateFiles: stubGenerateFiles });
    expect(await fs.readFile(join(dir, "src", "main.tsx"), "utf8")).toBe("export {}");
    // A3: the hand-edit was visible before overwrite
    expect(second.handEdited).toContain("src/main.tsx");
  });
});

describe("POST /api/projects/:id/generate", () => {
  it("返回落盘文件清单；未知 id 404；非法 id 400", async () => {
    const app = makeApp();
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/generate`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: string[] };
    expect(body.files).toContain("package.json");

    expect(
      (await app.request("/api/projects/00000000-0000-4000-8000-000000000000/generate", { method: "POST" })).status,
    ).toBe(404);
    expect((await app.request("/api/projects/not-a-uuid/generate", { method: "POST" })).status).toBe(400);
  });

  it("body 带文档时优先生成内存文档（未保存的画布编辑不落盘也能生成）", async () => {
    const app = makeApp();
    const bundle = await createProject(app);
    // 磁盘文档是默认空壳；内存文档带一个 StatCard
    const inMemory = {
      ...bundle.document,
      name: "内存版",
      nodes: [
        { id: "shell", type: "AppShell", props: { title: "内存版", sidebar: false }, children: ["c1"] },
        { id: "c1", type: "StatCard", props: { label: "指标", value: "1", tone: "brand" }, children: [] },
      ],
      rootId: "shell",
    };
    const res = await app.request(`/api/projects/${bundle.meta.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: inMemory }),
    });
    expect(res.status).toBe(200);
    // 生成产物取自内存文档：页面标题来自内存版而非磁盘默认
    const pageFile = ((await res.json()) as { files: string[] }).files.find((f) => f.includes("pages/"));
    expect(pageFile).toBeTruthy();
    const content = await app.request(
      `/api/projects/${bundle.meta.id}/files?path=${encodeURIComponent(pageFile!)}`,
    );
    const text = ((await content.json()) as { content: string }).content;
    // stub 生成器只透传 doc.name —— 断言内存文档（而非磁盘默认「运营工作台」）
    expect(text).toContain("内存版");
  });

  it("body 带非法文档时 422 document_invalid（不静默回退磁盘）", async () => {
    const app = makeApp();
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document: { documentVersion: 1, name: "x", rootId: "ghost", nodes: [] } }),
    });
    expect(res.status).toBe(422);
  });

  it("generateFiles 缺失（P3-1 未就绪）时返回 500 而不是静默失败", async () => {
    const app = createApp(createProjectsStore(baseDir)); // no generateFiles seam → dynamic import path
    const bundle = await createProject(app);
    const mod = await import("@studio/schema-core");
    const hasReal = typeof (mod as Record<string, unknown>).generateFiles === "function";
    if (hasReal) return; // generator landed: real integration covered by schema-core tests
    const res = await app.request(`/api/projects/${bundle.meta.id}/generate`, { method: "POST" });
    expect(res.status).toBe(500);
  });
});

describe("GET /api/projects/:id/files", () => {
  let app: ReturnType<typeof makeApp>;
  let bundle: ProjectBundle;

  beforeEach(async () => {
    app = makeApp();
    bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/generate`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("path 指定读取返回内容", async () => {
    const res = await app.request(`/api/projects/${bundle.meta.id}/files?path=src/main.tsx`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; content: string };
    expect(body.path).toBe("src/main.tsx");
    expect(body.content).toBe("export {}");
  });

  it("无 path 列出 src/ 文件清单", async () => {
    const res = await app.request(`/api/projects/${bundle.meta.id}/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: string[] };
    expect(body.files).toContain("src/main.tsx");
    expect(body.files.every((f) => f.startsWith("src/"))).toBe(true);
  });

  it("越狱路径 400：..、绝对路径、绝对 Windows 盘符", async () => {
    for (const p of ["../escape.txt", "C:\\Windows\\win.ini", "/etc/passwd"]) {
      const res = await app.request(`/api/projects/${bundle.meta.id}/files?path=${encodeURIComponent(p)}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_path");
    }
  });

  it("存在的项目内不存在文件 404", async () => {
    const res = await app.request(`/api/projects/${bundle.meta.id}/files?path=src/missing.tsx`);
    expect(res.status).toBe(404);
  });

  it("未知项目 404", async () => {
    expect((await app.request("/api/projects/00000000-0000-4000-8000-000000000000/files")).status).toBe(404);
  });
});

describe("POST /api/projects/:id/preview/start", () => {
  it("未生成（无 package.json）返回 409", async () => {
    const app = makeApp();
    const bundle = await createProject(app);
    const res = await app.request(`/api/projects/${bundle.meta.id}/preview/start`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_generated");
  });

  it("已生成的项目：注入 manager 后返回端口（已有产物不阻塞启动）", async () => {
    const app = createApp(createProjectsStore(baseDir), {
      generateFiles: stubGenerateFiles,
      previewManager: {
        start: async () => ({ port: 5184 }),
        stop: async () => {},
        status: () => [],
        shutdownAll: async () => {},
      },
    });
    const bundle = await createProject(app);
    const gen = await app.request(`/api/projects/${bundle.meta.id}/generate`, { method: "POST" });
    expect(gen.status).toBe(200);
    const res = await app.request(`/api/projects/${bundle.meta.id}/preview/start`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { port: number }).port).toBe(5184);
  });
});

describe("GET /api/health previews 计数", () => {
  it("注入 manager 时反映预览进程数", async () => {
    const status = [{ projectId: "p1", port: 5180, pid: 123 }];
    const app = createApp(createProjectsStore(baseDir), {
      previewManager: {
        start: async () => ({ port: 5180 }),
        stop: async () => {},
        status: () => status,
        shutdownAll: async () => {},
      },
    });
    const res = await app.request("/api/health");
    expect(((await res.json()) as { previews: number }).previews).toBe(1);
  });
});
