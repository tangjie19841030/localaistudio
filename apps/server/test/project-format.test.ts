import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStudioDocument, validateDocument } from "@studio/schema-core";
import { createProjectsStore } from "../src/store/projects.js";
import type { ProjectBundle } from "../src/store/projects.js";

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-fmt-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

const input = (name: string, projectType: "ui" | "ppt" | "word" = "ui") => ({
  name,
  productType: "",
  targetUsers: "",
  goal: "",
  referenceLinks: [],
  brandRules: "",
  projectType,
});

/** 手工铺设一个 legacy V1 项目目录（P7.2 之前 server 的写盘布局）。 */
async function seedLegacyProject(id: string, name: string): Promise<void> {
  const dir = join(baseDir, id);
  await fs.mkdir(join(dir, "design"), { recursive: true });
  await fs.writeFile(join(dir, "design", "document.json"), JSON.stringify(defaultStudioDocument(name), null, 2), "utf8");
  const now = new Date().toISOString();
  await fs.writeFile(
    join(dir, "project.json"),
    JSON.stringify(
      {
        id,
        name,
        productType: "",
        targetUsers: "",
        goal: "",
        referenceLinks: [],
        brandRules: "",
        createdAt: now,
        updatedAt: now,
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("V2 项目落盘格式（P7.2）", () => {
  it("create 写 document/document.json envelope，project.json 含 projectType/toolkitId/formatVersion", async () => {
    const store = createProjectsStore(baseDir);
    const bundle = await store.create(input("运营工作台"));
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, bundle.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw).toMatchObject({
      format: "studio-document",
      coreVersion: 1,
      projectType: "ui",
      toolkitId: "builtin.ui",
      toolkitVersion: "1.0.0",
      documentVersion: 1,
    });
    expect(validateDocument(raw.document).name).toBe("运营工作台");
    const metaRaw = JSON.parse(await fs.readFile(join(baseDir, bundle.meta.id, "project.json"), "utf8"));
    expect(metaRaw).toMatchObject({ projectType: "ui", toolkitId: "builtin.ui", formatVersion: 2 });
  });

  it("save 后重开：envelope documentVersion 递增", async () => {
    const store = createProjectsStore(baseDir);
    const created = (await store.create(input("版本递增"))) as ProjectBundle;
    const doc = { ...defaultStudioDocument("第二次"), tokens: created.document.tokens };
    await store.save(created.meta.id, { meta: created.meta, document: doc });
    const reopened = (await store.read(created.meta.id)) as ProjectBundle;
    expect(reopened.document.name).toBe("第二次");
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, created.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw.documentVersion).toBe(2);
    await store.save(created.meta.id, { meta: created.meta, document: doc });
    const raw2 = JSON.parse(
      await fs.readFile(join(baseDir, created.meta.id, "document", "document.json"), "utf8"),
    );
    expect(raw2.documentVersion).toBe(3);
  });

  it("已注册类型（ppt/word）创建成功并落盘各自空白文档（P7.3）", async () => {
    const store = createProjectsStore(baseDir);
    const ppt = (await store.create(input("幻灯片", "ppt"))) as { meta: { id: string }; document: { slides: unknown[]; slideSize: { w: number; h: number } } };
    expect(ppt.document.slides.length).toBeGreaterThan(0); // 空白 deck：1 张标题页
    expect(ppt.document.slideSize).toEqual({ w: 1280, h: 720 });
    const pptRaw = JSON.parse(await fs.readFile(join(baseDir, ppt.meta.id, "document", "document.json"), "utf8"));
    expect(pptRaw).toMatchObject({ projectType: "ppt", toolkitId: "builtin.ppt" });
    const word = (await store.create(input("文档", "word"))) as { meta: { id: string }; document: { blocks: unknown[]; sections: unknown[] } };
    expect(word.document.blocks.length).toBeGreaterThan(0); // 空白文档：1 节 1 段
    expect(word.document.sections).toHaveLength(1);
    const wordRaw = JSON.parse(await fs.readFile(join(baseDir, word.meta.id, "document", "document.json"), "utf8"));
    expect(wordRaw).toMatchObject({ projectType: "word", toolkitId: "builtin.word" });
  });

  it("非法 projectType（越权枚举）在 zod 层拒绝", async () => {
    const store = createProjectsStore(baseDir);
    await expect(
      store.create({ ...input("x"), projectType: "poster" as "ui" }),
    ).rejects.toThrow();
  });
});

describe("legacy V1 项目降级读（P7.2）", () => {
  it("legacy 项目无需迁移即可读：meta 补 projectType=ui，文档照常解析", async () => {
    const id = "00000000-0000-4000-8000-00000000abc1";
    await seedLegacyProject(id, "旧项目");
    const store = createProjectsStore(baseDir);
    const read = (await store.read(id)) as ProjectBundle;
    expect(read.meta.name).toBe("旧项目");
    expect(read.meta.projectType).toBe("ui");
    expect(read.document.name).toBe("旧项目");
    // formatInfo 报告 legacy 视图
    expect(await store.formatInfo(id)).toEqual({ source: "legacy", toolkitId: "builtin.ui" });
    // 读不重写盘：design/document.json 仍是裸文档，document/ 目录不存在
    const raw = JSON.parse(await fs.readFile(join(baseDir, id, "design", "document.json"), "utf8"));
    expect(raw.format).toBeUndefined();
    await expect(fs.readFile(join(baseDir, id, "document", "document.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("legacy 项目 save 仍写 design/document.json，不迁移格式", async () => {
    const id = "00000000-0000-4000-8000-00000000abc2";
    await seedLegacyProject(id, "旧项目");
    const store = createProjectsStore(baseDir);
    const read = (await store.read(id)) as ProjectBundle;
    const doc = { ...defaultStudioDocument("保存后"), tokens: read.document.tokens };
    const saved = (await store.save(id, { meta: read.meta, document: doc })) as ProjectBundle;
    expect(saved.document.name).toBe("保存后");
    const raw = JSON.parse(await fs.readFile(join(baseDir, id, "design", "document.json"), "utf8"));
    expect(raw.format).toBeUndefined(); // 仍是裸文档
    expect(raw.name).toBe("保存后");
    await expect(fs.readFile(join(baseDir, id, "document", "document.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("list 同时呈现 V2 与 legacy 项目", async () => {
    const store = createProjectsStore(baseDir);
    await store.create(input("新格式"));
    await seedLegacyProject("00000000-0000-4000-8000-00000000abc3", "旧格式");
    const list = await store.list();
    expect(list.map((m) => m.name).sort((a, b) => a.localeCompare(b))).toEqual(
      ["旧格式", "新格式"].sort((a, b) => a.localeCompare(b)),
    );
    expect(list.every((m) => m.projectType === "ui")).toBe(true);
  });

  it("meta 含 V2 键但 document/ 缺失时按 legacy 兜底读", async () => {
    // 模拟 V2 写入中途崩溃：meta 已带 formatVersion=2，但只有 design/ 里有文档。
    const id = "00000000-0000-4000-8000-00000000abc4";
    const dir = join(baseDir, id);
    await fs.mkdir(join(dir, "design"), { recursive: true });
    await fs.writeFile(join(dir, "design", "document.json"), JSON.stringify(defaultStudioDocument("半迁移"), null, 2), "utf8");
    const now = new Date().toISOString();
    await fs.writeFile(
      join(dir, "project.json"),
      JSON.stringify({ id, name: "半迁移", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "", createdAt: now, updatedAt: now, projectType: "ui", toolkitId: "builtin.ui", formatVersion: 2 }, null, 2),
      "utf8",
    );
    const read = (await createProjectsStore(baseDir).read(id)) as ProjectBundle;
    expect(read.document.name).toBe("半迁移");
  });
});
