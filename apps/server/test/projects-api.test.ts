import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStudioDocument } from "@studio/schema-core";
import { createApp } from "../src/app.js";
import { type ProjectBundle, createProjectsStore } from "../src/store/projects.js";

let baseDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-api-"));
  app = createApp(createProjectsStore(baseDir));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

const newProjectInput = {
  name: "运营工作台",
  productType: "后台",
  targetUsers: "运营",
  goal: "看数据",
  referenceLinks: [],
  brandRules: "不要渐变",
  projectType: "ui",
};

async function createProject(): Promise<ProjectBundle> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newProjectInput),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectBundle;
}

describe("POST /api/projects", () => {
  it("创建项目返回 201 bundle", async () => {
    const bundle = await createProject();
    expect(bundle.meta.name).toBe("运营工作台");
    expect(bundle.document.name).toBe("运营工作台");
  });

  it("非法 body 返回 400", async () => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productType: "x" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("新项目落盘为 V2 envelope 格式且 projectType 落盘（P7.2）", async () => {
    const bundle = await createProject();
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, bundle.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw).toMatchObject({ format: "studio-document", projectType: "ui", toolkitId: "builtin.ui" });
    const metaRaw = JSON.parse(await fs.readFile(join(baseDir, bundle.meta.id, "project.json"), "utf8"));
    expect(metaRaw.projectType).toBe("ui");
    expect(metaRaw.formatVersion).toBe(2);
  });

  it.each(["ppt", "word"] as const)("已注册类型 %s 创建 201（P7.3 注册后放行）", async (type) => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newProjectInput, projectType: type }),
    });
    expect(res.status).toBe(201);
    const bundle = (await res.json()) as { meta: { projectType: string }; document: Record<string, unknown> };
    expect(bundle.meta.projectType).toBe(type);
    // 空白文档：ppt 空白 deck（slides 数组）；word 空白文档（sections/blocks 数组）
    if (type === "ppt") {
      expect(Array.isArray(bundle.document.slides)).toBe(true);
      expect((bundle.document.slides as unknown[]).length).toBeGreaterThan(0);
      expect(bundle.document.slideSize).toEqual({ w: 1280, h: 720 });
    } else {
      expect(Array.isArray(bundle.document.sections)).toBe(true);
      expect(Array.isArray(bundle.document.blocks)).toBe(true);
      expect((bundle.document.blocks as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("非法 projectType 枚举值返回 400 invalid_body", async () => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newProjectInput, projectType: "poster" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_body");
  });
});

describe("GET /api/projects", () => {
  it("列表包含已创建项目", async () => {
    await createProject();
    const res = await app.request("/api/projects");
    const body = (await res.json()) as { projects: { name: string }[] };
    expect(body.projects.map((p) => p.name)).toEqual(["运营工作台"]);
  });
});

describe("GET /api/projects/:id", () => {
  it("未知 id 404；非法 id 400", async () => {
    expect((await app.request("/api/projects/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    // 单段非法 id 才能命中路由并触发 PathError（多段路径会被路由器直接 404）
    expect((await app.request("/api/projects/not-a-uuid")).status).toBe(400);
  });

  it("读取创建的项目", async () => {
    const bundle = await createProject();
    const res = await app.request(`/api/projects/${bundle.meta.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ProjectBundle).meta.id).toBe(bundle.meta.id);
  });
});

describe("PUT /api/projects/:id", () => {
  it("保存 meta+document 并返回刷新后的 bundle", async () => {
    const bundle = await createProject();
    const doc = { ...defaultStudioDocument("改名了"), tokens: bundle.document.tokens };
    const res = await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: bundle.meta, document: doc }),
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as ProjectBundle;
    expect(saved.document.name).toBe("改名了");
    expect(saved.meta.updatedAt >= bundle.meta.updatedAt).toBe(true);
  });

  it("save 后重开：envelope documentVersion 递增（P7.2）", async () => {
    const bundle = await createProject();
    const doc = { ...defaultStudioDocument("第二次保存"), tokens: bundle.document.tokens };
    await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: bundle.meta, document: doc }),
    });
    await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: bundle.meta, document: doc }),
    });
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, bundle.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw.documentVersion).toBe(3); // 创建 1 → save 2 → save 3
  });

  it("结构非法 document 返回 422 且不落盘", async () => {
    const bundle = await createProject();
    const doc = { ...bundle.document, pages: [{ ...bundle.document.pages[0]!, rootId: "missing" }] };
    const res = await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: bundle.meta, document: doc }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: string[] };
    expect(body.error).toBe("document_invalid");
    expect(body.issues[0]).toContain("missing");
    const reread = await app.request(`/api/projects/${bundle.meta.id}`);
    expect(((await reread.json()) as ProjectBundle).document.name).toBe("运营工作台");
  });

  it("未知 id 404；非法 id 400", async () => {
    expect(
      (
        await app.request("/api/projects/00000000-0000-4000-8000-000000000000", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meta: {}, document: {} }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("/api/projects/not-a-uuid", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meta: {}, document: {} }),
        })
      ).status,
    ).toBe(400);
  });
});

describe("legacy V1 项目 API 兼容（P7.2）", () => {
  const legacyId = "00000000-0000-4000-8000-00000000aaa1";

  beforeEach(async () => {
    // 手工铺设 legacy 目录：design/document.json 裸文档 + 无格式键 project.json
    const dir = join(baseDir, legacyId);
    await fs.mkdir(join(dir, "design"), { recursive: true });
    await fs.writeFile(
      join(dir, "design", "document.json"),
      JSON.stringify(defaultStudioDocument("遗留项目"), null, 2),
      "utf8",
    );
    const now = new Date().toISOString();
    await fs.writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        id: legacyId,
        name: "遗留项目",
        productType: "",
        targetUsers: "",
        goal: "",
        referenceLinks: [],
        brandRules: "",
        createdAt: now,
        updatedAt: now,
      }),
      "utf8",
    );
  });

  it("GET 返回 bundle（meta 补 projectType=ui），不重写磁盘", async () => {
    const res = await app.request(`/api/projects/${legacyId}`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as ProjectBundle;
    expect(bundle.meta.name).toBe("遗留项目");
    expect(bundle.meta.projectType).toBe("ui");
    expect(bundle.document.name).toBe("遗留项目");
    const raw = JSON.parse(await fs.readFile(join(baseDir, legacyId, "design", "document.json"), "utf8"));
    expect(raw.format).toBeUndefined(); // 磁盘仍是裸文档
  });

  it("PUT 保存仍写 legacy 路径（行为不变），列表可见", async () => {
    const read = (await (await app.request(`/api/projects/${legacyId}`)).json()) as ProjectBundle;
    const doc = { ...defaultStudioDocument("旧项目改名"), tokens: read.document.tokens };
    const res = await app.request(`/api/projects/${legacyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: { ...read.meta, name: "旧项目改名" }, document: doc }),
    });
    expect(res.status).toBe(200);
    const raw = JSON.parse(await fs.readFile(join(baseDir, legacyId, "design", "document.json"), "utf8"));
    expect(raw.format).toBeUndefined();
    expect(raw.name).toBe("旧项目改名");
    const list = (await (await app.request("/api/projects")).json()) as { projects: ProjectBundle["meta"][] };
    expect(list.projects.map((m) => m.name)).toContain("旧项目改名");
  });
});

describe("DELETE /api/projects/:id", () => {
  it("删除后 404", async () => {
    const bundle = await createProject();
    expect((await app.request(`/api/projects/${bundle.meta.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await app.request(`/api/projects/${bundle.meta.id}`)).status).toBe(404);
  });
});

describe("PUT 崩溃窗口修复语义（Task 6 审查采纳）", () => {
  it("meta 完好但文档损坏/缺失时，PUT 重存可修复", async () => {
    const bundle = await createProject();
    // 模拟崩溃窗口：meta 完好、文档损坏
    const docPath = join(baseDir, bundle.meta.id, "document", "document.json");
    await fs.writeFile(docPath, "{truncated", "utf8");
    const doc = { ...defaultStudioDocument("修复后"), tokens: bundle.document.tokens };
    const res = await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: bundle.meta, document: doc }),
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as ProjectBundle;
    expect(saved.document.name).toBe("修复后");
    const reread = await app.request(`/api/projects/${bundle.meta.id}`);
    expect(((await reread.json()) as ProjectBundle).document.name).toBe("修复后");
  });

  it("PUT 非法 meta（空 name）返回 400 invalid_body", async () => {
    const bundle = await createProject();
    const res = await app.request(`/api/projects/${bundle.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: { ...bundle.meta, name: "" }, document: bundle.document }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: string[] };
    expect(body.error).toBe("invalid_body");
    expect(body.issues[0]).toContain("name");
  });
});
