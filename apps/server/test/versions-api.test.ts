import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStudioDocument, type ProjectBundle } from "@studio/schema-core";
import { createApp } from "../src/app.js";
import { createProjectsStore } from "../src/store/projects.js";

interface VersionSummary {
  versionId: string;
  name: string;
  createdAt: string;
  projectId: string;
}

interface VersionFile {
  versionId: string;
  projectId: string;
  name: string;
  createdAt: string;
  document: Record<string, unknown>;
}

let baseDir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-ver-"));
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

/** Create a named version; returns the 201 body. */
async function createVersion(
  bundle: ProjectBundle,
  name: string,
  document: unknown = bundle.document,
): Promise<VersionSummary> {
  const res = await app.request(`/api/projects/${bundle.meta.id}/versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, document }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as VersionSummary;
}

async function listVersions(id: string): Promise<VersionSummary[]> {
  const res = await app.request(`/api/projects/${id}/versions`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { versions: VersionSummary[] }).versions;
}

describe("POST /api/projects/:id/versions", () => {
  it("创建版本：201 返回摘要，文件落盘 document/versions/<versionId>.json（V2，P7.2）", async () => {
    const bundle = await createProject();
    const v = await createVersion(bundle, "上线前备份");
    expect(v.name).toBe("上线前备份");
    expect(v.projectId).toBe(bundle.meta.id);
    expect(v.versionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(v.createdAt).toBeTypeOf("string");
    const raw = await fs.readFile(
      join(baseDir, bundle.meta.id, "document", "versions", `${v.versionId}.json`),
      "utf8",
    );
    expect(JSON.parse(raw).document.name).toBe("运营工作台");
    // V2 版本记录冻结 envelope 头部
    expect(JSON.parse(raw).envelope.toolkitId).toBe("builtin.ui");
  });

  it("非法 document 返回 422 且不落盘", async () => {
    const bundle = await createProject();
    const badDoc = { ...bundle.document, pages: [{ ...bundle.document.pages[0]!, rootId: "missing" }] };
    const res = await app.request(`/api/projects/${bundle.meta.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "坏版本", document: badDoc }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: string[] };
    expect(body.error).toBe("document_invalid");
    expect(body.issues[0]).toContain("missing");
    expect(await listVersions(bundle.meta.id)).toEqual([]);
  });

  it("非法 body（name 缺失/超长）返回 400 invalid_body", async () => {
    const bundle = await createProject();
    for (const name of ["", "x".repeat(61)]) {
      const res = await app.request(`/api/projects/${bundle.meta.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, document: bundle.document }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_body");
    }
  });

  it("未知项目 404；非法项目 id 400", async () => {
    const doc = defaultStudioDocument("任意");
    const mk = (id: string) =>
      app.request(`/api/projects/${id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "v", document: doc }),
      });
    expect((await mk("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await mk("not-a-uuid")).status).toBe(400);
  });
});

describe("GET /api/projects/:id/versions", () => {
  it("列表按 createdAt 倒序", async () => {
    const bundle = await createProject();
    const v1 = await createVersion(bundle, "第一版");
    await new Promise((r) => setTimeout(r, 5)); // createdAt 严格递增
    const v2 = await createVersion(bundle, "第二版");
    const list = await listVersions(bundle.meta.id);
    expect(list.map((v) => v.versionId)).toEqual([v2.versionId, v1.versionId]);
    expect(list.map((v) => v.name)).toEqual(["第二版", "第一版"]);
  });

  it("目录不存在（无版本）返回空数组", async () => {
    const bundle = await createProject();
    expect(await listVersions(bundle.meta.id)).toEqual([]);
  });

  it("单文件损坏跳过，列表保持可用", async () => {
    const bundle = await createProject();
    const v1 = await createVersion(bundle, "好版本");
    await fs.writeFile(
      join(baseDir, bundle.meta.id, "document", "versions", "00000000-0000-4000-8000-00000000bad.json"),
      "{truncated",
      "utf8",
    );
    const list = await listVersions(bundle.meta.id);
    expect(list.map((v) => v.versionId)).toEqual([v1.versionId]);
  });

  it("未知项目 404；非法项目 id 400", async () => {
    expect(
      (await app.request("/api/projects/00000000-0000-4000-8000-000000000000/versions")).status,
    ).toBe(404);
    expect((await app.request("/api/projects/not-a-uuid/versions")).status).toBe(400);
  });
});

describe("GET /api/projects/:id/versions/:versionId", () => {
  it("读取单个版本：返回含 document 的完整记录（跨会话对比的前提）", async () => {
    const bundle = await createProject();
    const v = await createVersion(bundle, "对比基准");
    const res = await app.request(`/api/projects/${bundle.meta.id}/versions/${v.versionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VersionFile;
    expect(body.versionId).toBe(v.versionId);
    expect(body.name).toBe("对比基准");
    expect(body.projectId).toBe(bundle.meta.id);
    expect(body.document.name).toBe("运营工作台");
  });

  it("不存在的版本 404", async () => {
    const bundle = await createProject();
    const res = await app.request(
      `/api/projects/${bundle.meta.id}/versions/00000000-0000-4000-8000-00000000dead`,
    );
    expect(res.status).toBe(404);
  });

  it("非法 versionId 400（越狱防护）", async () => {
    const bundle = await createProject();
    // 与 DELETE 同语义：含 "/" 或真实反斜杠的值会被路由归一成不命中本路由（→404），
    // 这里只测单段可命中的非法值。
    for (const bad of ["not-a-uuid", "..evil", "0000-0000"]) {
      const res = await app.request(`/api/projects/${bundle.meta.id}/versions/${bad}`);
      expect(res.status).toBe(400);
    }
  });

  it("未知项目 404", async () => {
    const res = await app.request(
      "/api/projects/00000000-0000-4000-8000-000000000000/versions/00000000-0000-4000-8000-00000000dead",
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:id/versions/:versionId", () => {
  it("删除版本后列表不再包含", async () => {
    const bundle = await createProject();
    const v = await createVersion(bundle, "待删");
    const res = await app.request(
      `/api/projects/${bundle.meta.id}/versions/${v.versionId}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect((await listVersions(bundle.meta.id)).map((x) => x.versionId)).toEqual([]);
  });

  it("不存在的版本 404", async () => {
    const bundle = await createProject();
    expect(
      (
        await app.request(
          `/api/projects/${bundle.meta.id}/versions/00000000-0000-4000-8000-00000000dead`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(404);
  });

  it("非法 versionId 400（越狱防护）", async () => {
    const bundle = await createProject();
    // 含 "/" 的路径会被路由归一成多段、根本不命中本路由（同 /api/projects/:id 的既有语义），
    // 这里只测单段可命中的非法值：非 uuid 与反斜杠穿越。
    for (const bad of ["not-a-uuid", "..\evil"]) {
      const res = await app.request(`/api/projects/${bundle.meta.id}/versions/${bad}`, {
        method: "DELETE",
      });
      expect(res.status, `versionId "${bad}" 应返回 400`).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_id");
    }
  });

  it("未知项目 404", async () => {
    expect(
      (
        await app.request(
          "/api/projects/00000000-0000-4000-8000-000000000000/versions/00000000-0000-4000-8000-00000000dead",
          { method: "DELETE" },
        )
      ).status,
    ).toBe(404);
  });
});

describe("版本保留策略（MAX_VERSIONS_PER_PROJECT = 50）", () => {
  it("创建第 51 个版本后最旧的被清理，文件数不超过 50", async () => {
    const bundle = await createProject();
    const first = await createVersion(bundle, "第1个");
    for (let i = 2; i <= 51; i++) {
      // createdAt 严格递增，保证淘汰顺序确定
      await new Promise((r) => setTimeout(r, 2));
      await createVersion(bundle, `第${i}个`);
    }
    const list = await listVersions(bundle.meta.id);
    expect(list).toHaveLength(50);
    expect(list.some((v) => v.versionId === first.versionId)).toBe(false); // 最旧的被清理
    expect(list[0]!.name).toBe("第51个");
    expect(list[49]!.name).toBe("第2个");
    // 磁盘文件同步收敛（不是只从列表里隐藏）
    const files = await fs.readdir(join(baseDir, bundle.meta.id, "document", "versions"));
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(50);
  });

  it("恰好 50 个版本时不再触发清理", async () => {
    const bundle = await createProject();
    for (let i = 1; i <= 50; i++) {
      await new Promise((r) => setTimeout(r, 2));
      await createVersion(bundle, `第${i}个`);
    }
    const list = await listVersions(bundle.meta.id);
    expect(list).toHaveLength(50);
    expect(list[49]!.name).toBe("第1个"); // 没有任何版本被误删
  });
});

describe("持久化语义", () => {
  it("重启模拟：新 store 实例读同目录，版本仍在且内容一致", async () => {
    const bundle = await createProject();
    const v = await createVersion(bundle, "跨重启");
    const app2 = createApp(createProjectsStore(baseDir));
    const res = await app2.request(`/api/projects/${bundle.meta.id}/versions`);
    const body = (await res.json()) as { versions: VersionSummary[] };
    expect(body.versions.map((x) => x.versionId)).toEqual([v.versionId]);
    // 文件内容自检：document 与 name 完整保留
    const raw = JSON.parse(
      await fs.readFile(join(baseDir, bundle.meta.id, "document", "versions", `${v.versionId}.json`), "utf8"),
    ) as VersionFile;
    expect(raw.name).toBe("跨重启");
    expect(raw.document.name).toBe("运营工作台");
    expect(raw.projectId).toBe(bundle.meta.id);
  });
});
