import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createProjectsStore } from "../src/store/projects.js";
import { registerPptExportRoutes } from "../src/toolkits/ppt/routes.js";
import { registerWordExportRoutes } from "../src/toolkits/word/routes.js";
import { detectOfficeCapabilities } from "../src/office/capabilities.js";
import type { OfficeCapabilities } from "../src/office/capabilities.js";
import { createEmptyDeck, type PptDocument } from "@studio/ppt-toolkit";
import { defaultPageSettings, defaultStyleSet, type WordDocument } from "@studio/word-toolkit";

/**
 * P9.2/P10.2 finishing: Office capability detection + PDF/PNG render routes +
 * quality inspection routes.
 *
 * The conversion engines (PowerPoint/Word COM, LibreOffice) depend on the
 * local machine, so route tests inject an all-unavailable capability probe
 * and assert the real 503 office_unavailable contract. Capability detection
 * itself runs against the actual machine but only asserts the result SHAPE —
 * never which apps exist. No fake Office results anywhere.
 */

const NO_OFFICE: OfficeCapabilities = { powerpoint: false, word: false, libreoffice: false };

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-office-export-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function createProject(projectType: "ppt" | "word" | "ui", name: string) {
  return createProjectsStore(baseDir).create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
    projectType,
  });
}

/** Both toolkits mounted on one app, like the real app.ts wiring. */
function appWith(caps: OfficeCapabilities): Hono {
  const app = new Hono();
  const deps = { store: createProjectsStore(baseDir), detectCapabilities: async () => caps };
  registerPptExportRoutes(app, deps);
  registerWordExportRoutes(app, deps);
  return app;
}

async function saveDeck(id: string, deck: PptDocument) {
  const store = createProjectsStore(baseDir);
  const { meta } = await store.read(id);
  await store.save(id, { meta, document: deck });
}

async function saveDoc(id: string, doc: WordDocument) {
  const store = createProjectsStore(baseDir);
  const { meta } = await store.read(id);
  await store.save(id, { meta, document: doc });
}

/**
 * Valid per the zod schema (the store rejects out-of-canvas rects at save
 * time) but still full of inspector findings: an empty title placeholder and
 * an object-less slide.
 */
function deckWithIssue(): PptDocument {
  const deck = createEmptyDeck("质检演示");
  deck.slides = [
    {
      id: "slide-1",
      title: "问题页",
      notes: "",
      objects: [
        { id: "ph-empty", kind: "placeholder", rect: { x: 80, y: 60, w: 400, h: 80 }, subtype: "title" },
      ],
    },
    { id: "slide-2", title: "空页", notes: "", objects: [] },
  ];
  return deck;
}

/**
 * Valid through the store's save-time zod + referential checks but still a
 * quality finding: heading levels jump 1 -> 3.
 */
function docWithIssue(): WordDocument {
  return {
    documentVersion: 1,
    name: "质检文档",
    sections: [{ id: "section-1", blockIds: ["h1", "h3"] }],
    blocks: [
      { id: "h1", type: "heading", level: 1, runs: [{ text: "一级标题" }] },
      { id: "h3", type: "heading", level: 3, runs: [{ text: "三级标题" }] },
    ],
    styles: defaultStyleSet(),
    pageSettings: defaultPageSettings(),
    footnotes: [],
    comments: [],
  };
}

describe("Office 能力检测（真实探测，仅断言形状）", () => {
  it(
    "返回三个布尔能力且 60s 内复用缓存",
    async () => {
      const first = await detectOfficeCapabilities();
      expect(typeof first.powerpoint).toBe("boolean");
      expect(typeof first.word).toBe("boolean");
      expect(typeof first.libreoffice).toBe("boolean");
      const second = await detectOfficeCapabilities();
      expect(second).toBe(first); // cache hit returns the identical object
    },
    30_000, // COM probes launch real processes; allow the full probe budget
  );
});

describe("Office 不可用 → 503 office_unavailable", () => {
  it("ppt 项目 /export/pdf 与 /export/png 均返回 503", async () => {
    const { meta } = await createProject("ppt", "幻灯项目");
    await saveDeck(meta.id, deckWithIssue());
    const app = appWith(NO_OFFICE);
    for (const format of ["pdf", "png"]) {
      const res = await app.request(`/api/projects/${meta.id}/export/${format}`, { method: "POST" });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("office_unavailable");
      expect(body.message).toContain("未检测到");
    }
  });

  it("word 项目 /export/pdf 与 /export/png（LibreOffice-only）均返回 503", async () => {
    const { meta } = await createProject("word", "文档项目");
    await saveDoc(meta.id, docWithIssue());
    const app = appWith(NO_OFFICE);
    for (const format of ["pdf", "png"]) {
      const res = await app.request(`/api/projects/${meta.id}/export/${format}`, { method: "POST" });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("office_unavailable");
    }
  });
});

describe("路由协作与类型不符", () => {
  it("word 项目请求 /export/pdf：ppt handler 放行，word handler 接管", async () => {
    const { meta } = await createProject("word", "接管项目");
    await saveDoc(meta.id, docWithIssue());
    const app = appWith(NO_OFFICE);
    const res = await app.request(`/api/projects/${meta.id}/export/pdf`, { method: "POST" });
    // word handler answered (503), proving the ppt handler forwarded via next()
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("office_unavailable");
  });

  it("非 office 项目（ui）请求 /export/pdf → 400 project_type_mismatch", async () => {
    const { meta } = await createProject("ui", "界面项目");
    const app = appWith(NO_OFFICE);
    const res = await app.request(`/api/projects/${meta.id}/export/pdf`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("project_type_mismatch");
    expect(body.message).toContain("ppt");
  });

  it("未知项目 → 404；非法 ID → 400", async () => {
    const app = appWith(NO_OFFICE);
    const missing = await app.request("/api/projects/00000000-0000-0000-0000-000000000000/export/pdf", {
      method: "POST",
    });
    expect(missing.status).toBe(404);
    const invalid = await app.request("/api/projects/not-a-uuid/export/png", { method: "POST" });
    expect(invalid.status).toBe(400);
  });
});

describe("质检路由", () => {
  it("POST /inspect/ppt 返回空占位符/空页问题并定位 slide/object", async () => {
    const { meta } = await createProject("ppt", "质检项目");
    await saveDeck(meta.id, deckWithIssue());
    const app = appWith(NO_OFFICE);
    const res = await app.request(`/api/projects/${meta.id}/inspect/ppt`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      issues: { inspectorId: string; slideId?: string; objectId?: string }[];
      checkedAt: string;
    };
    const placeholders = body.issues.filter((issue) => issue.inspectorId === "ppt.qc.empty-placeholder");
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toMatchObject({ slideId: "slide-1", objectId: "ph-empty" });
    const emptySlides = body.issues.filter((issue) => issue.inspectorId === "ppt.qc.empty-slide");
    expect(emptySlides).toHaveLength(1);
    expect(emptySlides[0]).toMatchObject({ slideId: "slide-2" });
    expect(typeof body.checkedAt).toBe("string");
  });

  it("POST /inspect/word 返回标题层级跳跃问题并定位块", async () => {
    const { meta } = await createProject("word", "质检文档项目");
    await saveDoc(meta.id, docWithIssue());
    const app = appWith(NO_OFFICE);
    const res = await app.request(`/api/projects/${meta.id}/inspect/word`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      issues: { inspectorId: string; blockId?: string; commentId?: string }[];
    };
    const jumps = body.issues.filter((issue) => issue.inspectorId === "word.qc.heading-jump");
    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toMatchObject({ blockId: "h3" });
  });

  it("inspect 路由类型不符 → 400；ui 项目请求 /inspect/word → 400", async () => {
    const { meta } = await createProject("ui", "错台项目");
    const app = appWith(NO_OFFICE);
    const res = await app.request(`/api/projects/${meta.id}/inspect/word`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_type_mismatch");
  });
});
