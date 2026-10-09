import { defaultStudioDocument, type StudioDocument } from "@studio/schema-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { db } from "../db/db";
import {
  loadVersions,
  removeVersion,
  saveVersion,
  type VersionListItem,
} from "./versionStore";

// T19 alias: the v1 whole-doc factory is now the v2 single-page doc.
const defaultDoc = defaultStudioDocument;

vi.mock("../api/client", () => ({
  api: {
    createVersion: vi.fn(),
    listVersions: vi.fn(),
    deleteVersion: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const PID = "00000000-0000-4000-8000-000000000000";
const DOC: StudioDocument = defaultDoc("运营工作台");

const remote = (versionId: string, name: string, createdAt: string) => ({
  versionId,
  projectId: PID,
  name,
  createdAt,


});

beforeEach(async () => {
  await db.versions.clear();
  vi.clearAllMocks();
});

describe("versionStore saveVersion（双写）", () => {
  it("server POST 成功后镜像写 Dexie，返回列表项", async () => {
    mockedApi.createVersion.mockResolvedValue(remote("v1", "上线前", "2026-01-01T00:00:01.000Z"));
    const item = await saveVersion(PID, "上线前", DOC);
    expect(item.name).toBe("上线前");
    expect(mockedApi.createVersion).toHaveBeenCalledWith(PID, { name: "上线前", document: DOC });
    const local = await db.versions.get("v1");
    expect(local?.name).toBe("上线前");
    expect(local?.document.name).toBe("运营工作台");
    expect(local?.projectId).toBe(PID);
  });

  it("server 失败时错误上浮且不写 Dexie", async () => {
    mockedApi.createVersion.mockRejectedValue(new Error("无法连接本地服务"));
    await expect(saveVersion(PID, "坏", DOC)).rejects.toThrow(/无法连接/);
    expect(await db.versions.count()).toBe(0);
  });
});

describe("versionStore loadVersions（优先 server，失败降级 Dexie）", () => {
  it("server 可用时返回 server 列表（createdAt 倒序透传；无本地镜像 document=null）", async () => {
    mockedApi.listVersions.mockResolvedValue([
      remote("v2", "新版", "2026-01-01T00:00:02.000Z"),
      remote("v1", "旧版", "2026-01-01T00:00:01.000Z"),
    ]);
    const list = await loadVersions(PID);
    expect(list.map((v) => v.name)).toEqual(["新版", "旧版"]);
    expect(mockedApi.listVersions).toHaveBeenCalledWith(PID);
    expect(list[0]?.document).toBeNull(); // 镜像缺失时仍可见，恢复不可用
  });

  it("server 可用且有本地镜像时恢复文档就绪", async () => {
    mockedApi.listVersions.mockResolvedValue([remote("v1", "镜像版", "2026-01-01T00:00:01.000Z")]);
    await db.versions.put({
      versionId: "v1",
      projectId: PID,
      name: "镜像版",
      document: DOC,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const list = await loadVersions(PID);
    expect(list[0]?.document?.name).toBe("运营工作台");
  });

  it("server 不可用时降级读 Dexie 本地镜像", async () => {
    await db.versions.put({
      versionId: "v1",
      projectId: PID,
      name: "本地镜像",
      document: DOC,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    mockedApi.listVersions.mockRejectedValue(new Error("无法连接本地服务"));
    const list = await loadVersions(PID);
    expect(list.map((v) => v.name)).toEqual(["本地镜像"]);
    expect(list[0]?.document?.name).toBe("运营工作台");
  });
});

describe("versionStore removeVersion", () => {
  it("server 与 Dexie 同删", async () => {
    await db.versions.put({
      versionId: "v1",
      projectId: PID,
      name: "待删",
      document: DOC,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    mockedApi.deleteVersion.mockResolvedValue({ ok: true });
    await removeVersion(PID, "v1");
    expect(mockedApi.deleteVersion).toHaveBeenCalledWith(PID, "v1");
    expect(await db.versions.get("v1")).toBeUndefined();
  });

  it("server 删除失败时错误上浮", async () => {
    mockedApi.deleteVersion.mockRejectedValue(new Error("404"));
    await expect(removeVersion(PID, "v1")).rejects.toThrow(/404/);
  });
});

describe("版本恢复文档来源", () => {
  it("降级路径返回的列表项含完整 document（恢复可用）", async () => {
    mockedApi.listVersions.mockRejectedValue(new Error("offline"));
    await db.versions.put({
      versionId: "v1",
      projectId: PID,
      name: "快照",
      document: DOC,
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    const list: VersionListItem[] = await loadVersions(PID);
    expect(list[0]?.document?.pages[0]!.rootId).toBe("root");
  });
});
