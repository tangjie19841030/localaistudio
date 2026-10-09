import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStudioDocument, newProjectId } from "@studio/schema-core";
import {
  NotFoundError,
  PathError,
  StoreError,
  createProjectsStore,
  type ProjectBundle,
} from "../src/store/projects.js";

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

const input = (name: string) => ({
  name,
  productType: "",
  targetUsers: "",
  goal: "",
  referenceLinks: [],
  brandRules: "",
  projectType: "ui" as const,
});

describe("projects store（磁盘）", () => {
  it("create 写 project.json 与 document/document.json（V2 envelope，P7.2）", async () => {
    const store = createProjectsStore(baseDir);
    const bundle = await store.create(input("运营工作台"));
    const metaRaw = await fs.readFile(join(baseDir, bundle.meta.id, "project.json"), "utf8");
    expect(JSON.parse(metaRaw).name).toBe("运营工作台");
    expect(JSON.parse(metaRaw).projectType).toBe("ui");
    const docRaw = JSON.parse(
      await fs.readFile(join(baseDir, bundle.meta.id, "document", "document.json"), "utf8"),
    );
    expect(docRaw.format).toBe("studio-document");
    expect(docRaw.document.name).toBe("运营工作台");
  });

  it("list 按 updatedAt 倒序", async () => {
    const store = createProjectsStore(baseDir);
    await store.create(input("a"));
    await new Promise((r) => setTimeout(r, 5)); // 保证 updatedAt 严格递增
    await store.create(input("b"));
    const list = await store.list();
    expect(list.map((m) => m.name)).toEqual(["b", "a"]);
  });

  it("重启模拟：新实例读取同一目录，数据仍在", async () => {
    const created = (await createProjectsStore(baseDir).create(input("持久"))) as ProjectBundle;
    const storeB = createProjectsStore(baseDir);
    const read = (await storeB.read(created.meta.id)) as ProjectBundle;
    expect(read.meta.name).toBe("持久");
    expect(read.document.name).toBe("持久");
  });

  it("save 更新文档并刷新 updatedAt", async () => {
    const store = createProjectsStore(baseDir);
    const created = (await store.create(input("x"))) as ProjectBundle;
    const doc = { ...defaultStudioDocument("新名字"), tokens: created.document.tokens };
    const saved = (await store.save(created.meta.id, { meta: created.meta, document: doc })) as ProjectBundle;
    expect(saved.document.name).toBe("新名字");
    expect(saved.meta.updatedAt >= created.meta.updatedAt).toBe(true);
    expect(((await store.read(created.meta.id)) as ProjectBundle).document.name).toBe("新名字");
  });

  it("remove 删除目录；read 未知 id 抛 NotFoundError", async () => {
    const store = createProjectsStore(baseDir);
    const created = await store.create(input("x"));
    await store.remove(created.meta.id);
    await expect(store.read(created.meta.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("路径越狱 id 抛 PathError", async () => {
    const store = createProjectsStore(baseDir);
    await expect(store.read("../evil")).rejects.toBeInstanceOf(PathError);
    await expect(store.read("a/b")).rejects.toBeInstanceOf(PathError);
    await expect(store.remove("..\\evil")).rejects.toBeInstanceOf(PathError);
  });

  it("目录与元数据 ID 不一致时抛 StoreError（Task 3 审查采纳）", async () => {
    const store = createProjectsStore(baseDir);
    const created = await store.create(input("漂移"));
    const metaPath = join(baseDir, created.meta.id, "project.json");
    const raw = JSON.parse(await fs.readFile(metaPath, "utf8"));
    raw.id = newProjectId();
    await fs.writeFile(metaPath, JSON.stringify(raw), "utf8");
    await expect(store.read(created.meta.id)).rejects.toThrow(/不一致/);
  });

  it("list 跳过损坏目录并返回健康项目（Task 3 审查采纳）", async () => {
    const store = createProjectsStore(baseDir);
    await store.create(input("好项目"));
    const brokenId = "00000000-0000-4000-8000-00000000dead";
    await fs.mkdir(join(baseDir, brokenId), { recursive: true });
    await fs.writeFile(join(baseDir, brokenId, "project.json"), "{oops", "utf8");
    const list = await store.list();
    expect(list.map((m) => m.name)).toEqual(["好项目"]);
  });
});

describe("store 契约补齐（Task 5 审查采纳）", () => {
  it("save 未知 id 抛 NotFoundError", async () => {
    const store = createProjectsStore(baseDir);
    const created = await store.create(input("x"));
    const otherId = newProjectId();
    await expect(
      store.save(otherId, { meta: { ...created.meta, id: otherId }, document: created.document }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("save 强制 id/updatedAt、保留服务端 createdAt", async () => {
    const store = createProjectsStore(baseDir);
    const created = (await store.create(input("x"))) as ProjectBundle;
    const forged = {
      meta: { ...created.meta, id: newProjectId(), createdAt: "2000-01-01T00:00:00.000Z", updatedAt: "2000-01-01T00:00:00.000Z" },
      document: { ...defaultStudioDocument("伪造"), tokens: created.document.tokens },
    };
    const saved = (await store.save(created.meta.id, forged)) as ProjectBundle;
    expect(saved.meta.id).toBe(created.meta.id);
    expect(saved.meta.createdAt).toBe(created.meta.createdAt);
    expect(saved.meta.updatedAt > created.meta.updatedAt).toBe(true);
    expect((await store.read(created.meta.id)).meta.id).toBe(created.meta.id);
  });

  it("remove 后 list 不再包含该项目", async () => {
    const store = createProjectsStore(baseDir);
    const a = await store.create(input("a"));
    await store.create(input("b"));
    await store.remove(a.meta.id);
    const list = await store.list();
    expect(list.map((m) => m.name)).toEqual(["b"]);
  });

  it("meta 存在但文档缺失时 read 抛 NotFoundError（崩溃窗口语义）", async () => {
    const store = createProjectsStore(baseDir);
    const created = await store.create(input("x"));
    await fs.rm(join(baseDir, created.meta.id, "document"), { recursive: true });
    await expect(store.read(created.meta.id)).rejects.toThrow(/项目文档不存在/);
  });

  it("save 拒绝结构非法的 document（写侧校验）", async () => {
    const store = createProjectsStore(baseDir);
    const created = (await store.create(input("x"))) as ProjectBundle;
    const bad = { ...created.document, pages: [{ ...created.document.pages[0]!, rootId: "missing" }] };
    await expect(store.save(created.meta.id, { meta: created.meta, document: bad })).rejects.toThrow(
      /不在节点表中/,
    );
  });
});

describe("store exists（Task 6 审查采纳）", () => {
  it("存在时静默通过；未知/越狱 id 分别抛 NotFound/PathError", async () => {
    const store = createProjectsStore(baseDir);
    const created = await store.create(input("x"));
    await expect(store.exists(created.meta.id)).resolves.toBeUndefined();
    await expect(store.exists(newProjectId())).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.exists("../evil")).rejects.toBeInstanceOf(PathError);
  });
});
