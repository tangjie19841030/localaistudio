import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";
import { createEmptyDeck, type PptDocument } from "@studio/ppt-toolkit";
import { emptyWordDocument, type WordDocument } from "@studio/word-toolkit";

/**
 * P7.3: ppt/word 项目走通完整 API 生命周期。
 * 契约：
 * - POST /api/projects { projectType: "ppt"|"word" } → 201，document 是各自空白文档；
 * - GET /api/projects/:id → { meta, document }，document 是领域文档（无信封包裹）；
 * - PUT 合法领域文档 → 200，磁盘 envelope.projectType/toolkitId 与项目一致；
 * - PUT 结构非法文档 → 422 document_invalid（路由层放行，store 的 toolkit.parse 拒）；
 * - PUT 试图把项目类型从 ui 改成 ppt（或反之）→ 500 store_error（类型不可变更）。
 */

let baseDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-pptword-"));
  app = createApp(createProjectsStore(baseDir));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

const input = (name: string, projectType: "ppt" | "word") => ({
  name,
  productType: "",
  targetUsers: "",
  goal: "",
  referenceLinks: [],
  brandRules: "",
  projectType,
});

/** 创建项目并断言 201；返回解析后的 bundle。 */
async function createProject(projectType: "ppt" | "word", name: string) {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input(name, projectType)),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { meta: { id: string; projectType: string; name: string }; document: unknown };
}

describe.each(["ppt", "word"] as const)("projectType=%s 的项目生命周期", (type) => {
  it("create 后 GET 返回空白领域文档（无信封包裹）", async () => {
    const created = await createProject(type, "示例");
    expect(created.meta.projectType).toBe(type);

    const res = await app.request(`/api/projects/${created.meta.id}`);
    expect(res.status).toBe(200);
    const bundle = (await res.json()) as { meta: { projectType: string }; document: Record<string, unknown> };
    expect(bundle.meta.projectType).toBe(type);
    // API 形状契约：document 是领域文档本体，不含 format/toolkitId 信封键
    expect(bundle.document.format).toBeUndefined();
    expect(bundle.document.toolkitId).toBeUndefined();
    if (type === "ppt") {
      expect(bundle.document.slideSize).toEqual({ w: 1280, h: 720 });
      expect(bundle.document.slides).toHaveLength(1); // 空白 deck：1 张标题页
    } else {
      expect(bundle.document.sections).toHaveLength(1); // 空白文档：1 节
      expect(bundle.document.blocks).toHaveLength(1); // 1 个空段落块
      expect(bundle.document.pageSettings).toMatchObject({ width: 595.3, height: 841.9 });
    }
  });

  it("create 落盘 envelope 的 projectType/toolkitId 正确", async () => {
    const created = await createProject(type, "落盘检查");
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, created.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw.format).toBe("studio-document");
    expect(raw.projectType).toBe(type);
    expect(raw.toolkitId).toBe(`builtin.${type}`);
  });

  it("PUT 保存合法文档 → 200，重开内容一致且 envelope 版本递增", async () => {
    const created = await createProject(type, "保存测试");
    const document: PptDocument | WordDocument =
      type === "ppt" ? createEmptyDeck("新名字") : emptyWordDocument("新名字");
    const res = await app.request(`/api/projects/${created.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: created.meta, document }),
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { meta: { id: string }; document: { name: string } };
    expect(saved.document.name).toBe("新名字");

    const reread = (await (await app.request(`/api/projects/${created.meta.id}`)).json()) as {
      document: { name: string };
    };
    expect(reread.document.name).toBe("新名字");
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, created.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw.documentVersion).toBe(2); // create 1 → save 2
    expect(raw.projectType).toBe(type);
  });

  it("PUT 结构非法文档 → 422 document_invalid，不落盘", async () => {
    const created = await createProject(type, "非法测试");
    // 领域形状错乱：ppt 缺 slides；word 缺 sections/blocks
    const bad =
      type === "ppt"
        ? { documentVersion: 1, name: "坏", presentation: {}, slideSize: { w: 1280, h: 720 }, theme: {}, masters: [], layouts: [] }
        : { documentVersion: 1, name: "坏", sections: "not-an-array", blocks: [], styles: {}, pageSettings: {}, footnotes: [], comments: [] };
    const res = await app.request(`/api/projects/${created.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: created.meta, document: bad }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: string[] };
    expect(body.error).toBe("document_invalid");
    expect(body.issues.length).toBeGreaterThan(0);
    // 不落盘：GET 仍是创建时的空白文档
    const reread = (await (await app.request(`/api/projects/${created.meta.id}`)).json()) as {
      document: { name: string };
    };
    expect(reread.document.name).toBe("非法测试");
  });

  it("PUT 用另一类型的文档（类型混淆）→ 422", async () => {
    const created = await createProject(type, "类型混淆");
    // ppt 项目收 word 文档（或反之）——toolkit.parse 必须拒绝
    const wrongDoc: unknown =
      type === "ppt" ? emptyWordDocument("串台") : createEmptyDeck("串台");
    const res = await app.request(`/api/projects/${created.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: created.meta, document: wrongDoc }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("document_invalid");
  });

  it("PUT meta 偷换 projectType → 拒绝（项目类型不可变更）", async () => {
    const created = await createProject(type, "偷换类型");
    const document = type === "ppt" ? createEmptyDeck("x") : emptyWordDocument("x");
    const res = await app.request(`/api/projects/${created.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meta: { ...created.meta, projectType: type === "ppt" ? "word" : "ppt" },
        document,
      }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("store_error");
    expect(body.message).toContain("项目类型不可变更");
  });
});

describe("UI 项目的 PUT 契约不受泛化影响", () => {
  it("UI 项目 PUT 非法 document 仍是 400 invalid_body（路由层 zod 快速失败）", async () => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input("UI项目", "ppt"), projectType: "ui" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { meta: { id: string } };
    const put = await app.request(`/api/projects/${created.meta.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: created.meta, document: { wrong: true } }),
    });
    expect(put.status).toBe(400);
    expect(((await put.json()) as { error: string }).error).toBe("invalid_body");
  });
});
