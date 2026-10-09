import { defaultStudioDocument, newProjectMeta } from "@studio/schema-core";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { listLocalProjects, putDocument, putProjectMeta, readDocument } from "./repo";
import { deleteVersion, getVersion, listVersions, putVersion } from "./repo";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

beforeEach(async () => {
  await db.projects.clear();
  await db.documents.clear();
  await db.versions.clear();
});

describe("Dexie 本地存储", () => {
  it("项目 meta 增改查", async () => {
    const meta = newProjectMeta({ name: "本地", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" });
    await putProjectMeta(meta);
    const updated = { ...meta, name: "改名" };
    await putProjectMeta(updated);
    expect((await listLocalProjects()).map((m) => m.name)).toEqual(["改名"]);
  });

  it("document 按 projectId 存取（put 覆盖同键）", async () => {
    await putDocument("p1", defaultDoc("v1"), new Date().toISOString());
    await putDocument("p1", defaultDoc("v2"), new Date().toISOString());
    const rec = await readDocument("p1");
    expect(rec?.document.name).toBe("v2");
    expect(await readDocument("p2")).toBeUndefined();
  });

  it("listLocalProjects 按 updatedAt 倒序（新→旧）", async () => {


    const older = newProjectMeta({ name: "旧", productType: "", targetUsers: "", goal: "", referenceLinks: [], brandRules: "" });
    const newer = { ...older, id: crypto.randomUUID(), name: "新", updatedAt: "2026-01-01T00:00:02.000Z" };
    const oldest = { ...older, id: crypto.randomUUID(), name: "最旧", updatedAt: "2026-01-01T00:00:00.000Z" };
    older.updatedAt = "2026-01-01T00:00:01.000Z";
    await putProjectMeta(older);
    await putProjectMeta(newer);
    await putProjectMeta(oldest);
    expect((await listLocalProjects()).map((m) => m.name)).toEqual(["新", "旧", "最旧"]);
  });
});

describe("Dexie versions 表（P1-10）", () => {
  const version = (projectId: string, versionId: string, name: string, createdAt: string) => ({
    versionId,
    projectId,
    name,
    document: defaultDoc(name),
    createdAt,
  });

  it("putVersion/getVersion 增查", async () => {
    await putVersion(version("p1", "v1", "上线前", "2026-01-01T00:00:01.000Z"));
    const got = await getVersion("p1", "v1");
    expect(got?.name).toBe("上线前");
    expect(got?.document.name).toBe("上线前");
    // projectId 隔离：其他项目读不到
    expect(await getVersion("p2", "v1")).toBeUndefined();
  });

  it("listVersions 只含本项目且按 createdAt 倒序", async () => {
    await putVersion(version("p1", "v1", "旧版", "2026-01-01T00:00:01.000Z"));
    await putVersion(version("p1", "v2", "新版", "2026-01-01T00:00:02.000Z"));
    await putVersion(version("p2", "v3", "别的项目", "2026-01-01T00:00:03.000Z"));
    const list = await listVersions("p1");
    expect(list.map((v) => v.name)).toEqual(["新版", "旧版"]);
  });

  it("deleteVersion 删除后读不到", async () => {
    await putVersion(version("p1", "v1", "待删", "2026-01-01T00:00:01.000Z"));
    await deleteVersion("p1", "v1");
    expect(await getVersion("p1", "v1")).toBeUndefined();
    expect(await listVersions("p1")).toEqual([]);
  });
});
