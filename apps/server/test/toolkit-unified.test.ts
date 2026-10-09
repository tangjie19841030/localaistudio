import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createProjectsStore, type ProjectsStore } from "../src/store/projects.js";
import { registerPptExportRoutes } from "../src/toolkits/ppt/routes.js";
import { registerWordExportRoutes } from "../src/toolkits/word/routes.js";
import { emptyWordDocument, type WordDocument } from "@studio/word-toolkit";

/**
 * PPT/Word unified delivery contract: both toolkits register their export
 * routes on ONE app (same order as app.ts: ppt first, word second) and must
 * behave symmetrically on the shared paths — /export/pdf|png forward between
 * the handlers, type mismatches map to the same 400 code, and the attachment
 * filename protocol is the SAME RFC 5987 shape for docx and pptx (word's
 * pre-unification copy percent-encoded Chinese names inside the plain token).
 * Office conversion is exercised only up to the honest 503 (probe injected
 * as unavailable) so no real PowerPoint/LibreOffice launch happens in CI.
 */

let baseDir: string;
let app: Hono;
let store: ProjectsStore;
const officeAbsent = async () => ({ powerpoint: false, word: false, libreoffice: false });

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-toolkit-unified-"));
  store = createProjectsStore(baseDir);
  app = new Hono();
  registerPptExportRoutes(app, { store, detectCapabilities: officeAbsent });
  registerWordExportRoutes(app, { store, detectCapabilities: officeAbsent });
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

async function createProject(projectType: "ui" | "ppt" | "word", name: string) {
  return store.create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
    projectType,
  });
}

async function saveWordDoc(id: string, doc: WordDocument) {
  const { meta } = await store.read(id);
  await store.save(id, { meta, document: doc });
}

function dispositionFilename(res: Response): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const extended = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
  return extended ? decodeURIComponent(extended) : "";
}

describe("统一交付：/export/pdf|png 跨工具包转发", () => {
  it("word 项目请求 /export/pdf：ppt 处理器转发给 word 处理器（503 office_unavailable）", async () => {
    const { meta } = await createProject("word", "转发检查");
    await saveWordDoc(meta.id, emptyWordDocument("转发检查"));
    const res = await app.request(`/api/projects/${meta.id}/export/pdf`, { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("office_unavailable");
  });

  it("ppt 项目请求 /export/pdf|png：本域处理器直接应答（同样 503）", async () => {
    const { meta } = await createProject("ppt", "转发检查");
    for (const path of ["export/pdf", "export/png"]) {
      const res = await app.request(`/api/projects/${meta.id}/${path}`, { method: "POST" });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("office_unavailable");
    }
  });

  it("word 项目请求 /export/png 同样转发（对称）", async () => {
    const { meta } = await createProject("word", "转发PNG");
    await saveWordDoc(meta.id, emptyWordDocument("转发PNG"));
    const res = await app.request(`/api/projects/${meta.id}/export/png`, { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("office_unavailable");
  });

  it("ui 项目请求 /export/pdf：两个处理器都不认领 → 400 project_type_mismatch", async () => {
    const { meta } = await createProject("ui", "网页");
    const res = await app.request(`/api/projects/${meta.id}/export/pdf`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("project_type_mismatch");
  });
});

describe("统一交付：类型守卫对称", () => {
  it("ppt 项目 → /export/docx 与 word 项目 → /export/pptx 都是 400 project_type_mismatch", async () => {
    const ppt = await createProject("ppt", "演示");
    const word = await createProject("word", "文档");

    const toDocx = await app.request(`/api/projects/${ppt.meta.id}/export/docx`, { method: "POST" });
    expect(toDocx.status).toBe(400);
    expect(((await toDocx.json()) as { error: string }).error).toBe("project_type_mismatch");

    const toPptx = await app.request(`/api/projects/${word.meta.id}/export/pptx`, { method: "POST" });
    expect(toPptx.status).toBe(400);
    expect(((await toPptx.json()) as { error: string }).error).toBe("project_type_mismatch");
  });

  it("inspect 端点对称：word 项目 → /inspect/ppt、ppt 项目 → /inspect/word 都 400", async () => {
    const ppt = await createProject("ppt", "演示");
    const word = await createProject("word", "文档");

    const toPptInspect = await app.request(`/api/projects/${word.meta.id}/inspect/ppt`, { method: "POST" });
    expect(toPptInspect.status).toBe(400);
    expect(((await toPptInspect.json()) as { error: string }).error).toBe("project_type_mismatch");

    const toWordInspect = await app.request(`/api/projects/${ppt.meta.id}/inspect/word`, { method: "POST" });
    expect(toWordInspect.status).toBe(400);
    expect(((await toWordInspect.json()) as { error: string }).error).toBe("project_type_mismatch");
  });
});

describe("统一交付：附件文件名协议（RFC 5987 对称）", () => {
  it("docx 与 pptx 中文文件名都走 filename*=UTF-8''，回退 token 下划线化", async () => {
    const word = await createProject("word", "季度报告甲");
    await saveWordDoc(word.meta.id, emptyWordDocument("季度报告甲"));
    const docx = await app.request(`/api/projects/${word.meta.id}/export/docx`, { method: "POST" });
    expect(docx.status).toBe(200);
    const disposition = docx.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("filename*=UTF-8''");
    expect(dispositionFilename(docx)).toBe("季度报告甲.docx");

    const ppt = await createProject("ppt", "季度汇报乙");
    const pptx = await app.request(`/api/projects/${ppt.meta.id}/export/pptx`, { method: "POST" });
    expect(pptx.status).toBe(200);
    const pptDisposition = pptx.headers.get("content-disposition") ?? "";
    expect(pptDisposition).toContain("filename*=UTF-8''");
    expect(dispositionFilename(pptx)).toBe("季度汇报乙.pptx");
    // plain token is pure ASCII in both protocols
    expect(pptDisposition.split(";")[0]).toBe("attachment");
  });

  it("Windows 保留设备名项目名两个工具包都回退为项目 id", async () => {
    const word = await createProject("word", "con");
    await saveWordDoc(word.meta.id, emptyWordDocument("con"));
    const docx = await app.request(`/api/projects/${word.meta.id}/export/docx`, { method: "POST" });
    expect(dispositionFilename(docx)).toBe(`${word.meta.id}.docx`);

    const ppt = await createProject("ppt", "con");
    const pptx = await app.request(`/api/projects/${ppt.meta.id}/export/pptx`, { method: "POST" });
    expect(dispositionFilename(pptx)).toBe(`${ppt.meta.id}.pptx`);
  });

  it("导出副本都落盘到 <project>/export/", async () => {
    const word = await createProject("word", "落盘对称");
    await saveWordDoc(word.meta.id, emptyWordDocument("落盘对称"));
    await app.request(`/api/projects/${word.meta.id}/export/docx`, { method: "POST" });
    const ppt = await createProject("ppt", "落盘对称");
    await app.request(`/api/projects/${ppt.meta.id}/export/pptx`, { method: "POST" });
    const wordFiles = await fs.readdir(join(baseDir, word.meta.id, "export"));
    const pptFiles = await fs.readdir(join(baseDir, ppt.meta.id, "export"));
    expect(wordFiles.some((name) => name.endsWith(".docx"))).toBe(true);
    expect(pptFiles.some((name) => name.endsWith(".pptx"))).toBe(true);
  });
});
