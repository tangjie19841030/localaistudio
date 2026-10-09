import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createProjectsStore, type ProjectsStore } from "../src/store/projects.js";
import type { GenerateFiles } from "../src/codegen/files.js";
import type { PreviewManager } from "../src/preview/processes.js";
import type { ScreenshotRunner, ShotOutcome, ShotRequest } from "../src/visual/screenshots.js";
import {
  registerUiPdfExportRoute,
  type PdfRunner,
} from "../src/visual/ui-pdf.js";

/**
 * W2-B route contract: POST /api/projects/:id/export/ui-pdf?mode=single|multi.
 *
 * Both browser seams are injected: the pdf runner writes real `%PDF-` bytes and
 * the screenshot runner writes real PNG bytes, so single/multi pipelines are
 * asserted end-to-end (including the composed PDF's page boxes) without ever
 * launching chromium. The real runners are exercised by the manual smoke.
 *
 * Registered through registerUiPdfExportRoute directly because app.ts is out of
 * this unit's file list: the pdf seam is not reachable through createApp.
 */

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const FAKE_PORT = 5188;

/** 2x3 and 3x2 solid PNGs — distinct sizes prove per-page box + ordering. */
const PNG_2X3 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEUlEQVR4nGP4z8DwnwGMERQARNAF+7BYSawAAAAASUVORK5CYII=",
  "base64",
);
const PNG_3X2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAD0lEQVR4nGNgYPgPQzAWADXeBfvilmCeAAAAAElFTkSuQmCC",
  "base64",
);

let baseDir: string;

beforeEach(async () => {
  baseDir = await fs.mkdtemp(join(tmpdir(), "studio-ui-pdf-export-"));
});

afterEach(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

function fakeManager(): { manager: PreviewManager; starts: { projectId: string; projectDir: string }[] } {
  const starts: { projectId: string; projectDir: string }[] = [];
  return {
    starts,
    manager: {
      start: async (projectId, projectDir) => {
        starts.push({ projectId, projectDir });
        return { port: FAKE_PORT };
      },
      stop: async () => {},
      status: () => [],
      shutdownAll: async () => {},
    },
  };
}

/** Fake pdf runner: writes a minimal real PDF, never touches a browser. */
function fakePdfRunner(): { run: PdfRunner; calls: { url: string; outFile: string }[] } {
  const calls: { url: string; outFile: string }[] = [];
  const run: PdfRunner = async (req) => {
    calls.push(req);
    await fs.writeFile(req.outFile, Buffer.from("%PDF-1.4\n%%EOF\n", "latin1"));
  };
  return { run, calls };
}

/** Fake screenshot runner: one desktop PNG per call, sizes alternating. */
function fakeShotRunner(): { run: ScreenshotRunner; calls: ShotRequest[] } {
  const calls: ShotRequest[] = [];
  const run: ScreenshotRunner = async (req) => {
    const png = calls.length % 2 === 0 ? PNG_2X3 : PNG_3X2;
    calls.push(req);
    const file = "desktop.png";
    await fs.writeFile(join(req.outDir, file), png);
    const outcome: ShotOutcome = {
      shots: [{ viewport: "desktop", file }],
      metrics: [],
    };
    return outcome;
  };
  return { run, calls };
}

interface Harness {
  app: Hono;
  starts: { projectId: string; projectDir: string }[];
  pdfCalls: { url: string; outFile: string }[];
  shotCalls: ShotRequest[];
}

const okGenerateFiles: GenerateFiles = () =>
  new Map([
    ["package.json", "{}"],
    ["src/main.tsx", "export {};\n"],
  ]);

function makeHarness(extra?: {
  generateFiles?: GenerateFiles;
  pdfRunner?: PdfRunner;
  shotRunner?: ScreenshotRunner;
}): Harness {
  const { manager, starts } = fakeManager();
  const pdf = fakePdfRunner();
  const shots = fakeShotRunner();
  const app = new Hono();
  registerUiPdfExportRoute(app, {
    store: createProjectsStore(baseDir),
    previewManager: manager,
    runner: extra?.shotRunner ?? shots.run,
    pdfRunner: extra?.pdfRunner ?? pdf.run,
    generateFiles: extra?.generateFiles ?? okGenerateFiles,
  });
  return { app, starts, pdfCalls: pdf.calls, shotCalls: shots.calls };
}

async function createUiProject(store: ProjectsStore, name: string) {
  return store.create({
    name,
    productType: "",
    targetUsers: "",
    goal: "",
    referenceLinks: [],
    brandRules: "",
  });
}

/** Adds a second page (own id prefix) and persists the two-page document. */
async function saveTwoPageProject(store: ProjectsStore, name: string) {
  const bundle = await createUiProject(store, name);
  const doc = bundle.document as { pages: { id: string; name: string; rootId: string; nodes: unknown[] }[] };
  const second = {
    id: "page-2",
    name: "第二页",
    rootId: "root-2",
    nodes: [{ id: "root-2", type: "Container", props: {}, children: [] }],
  };
  const twoPage = { ...(bundle.document as object), pages: [...doc.pages, second] };
  const saved = await store.save(bundle.meta.id, { meta: bundle.meta, document: twoPage });
  return { bundle, saved };
}

describe("POST /api/projects/:id/export/ui-pdf", () => {
  it("mode=single（默认）：起预览→page.pdf→attachment PDF，留档 export/ 同字节", async () => {
    const store = createProjectsStore(baseDir);
    const { app, starts, pdfCalls } = makeHarness();
    const bundle = await createUiProject(store, "运营工作台");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-pdf`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // 单页语义 = 渲染 pages[0] 所在工程（OP-3），只起一次服、只打印一次
    expect(starts).toEqual([{ projectId: bundle.meta.id, projectDir: join(baseDir, bundle.meta.id) }]);
    expect(pdfCalls).toHaveLength(1);
    expect(pdfCalls[0]!.url).toBe(`http://127.0.0.1:${FAKE_PORT}`);
    expect(pdfCalls[0]!.outFile).toContain(join("export", "ui-pdf"));

    const archived = await fs.readFile(join(baseDir, bundle.meta.id, "export", "运营工作台-ui-pdf.pdf"));
    expect(archived).toEqual(bytes);
  });

  it("mode=multi：逐页起服截图→pdf-lib 合成，页数=页数且页盒=PNG 像素×72/96", async () => {
    const store = createProjectsStore(baseDir);
    const { app, starts, shotCalls, pdfCalls } = makeHarness();
    const { bundle } = await saveTwoPageProject(store, "多页站");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-pdf?mode=multi`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // 每页一次起服 + 一次截图，出目录按页序分离；multi 不调用 pdf runner
    expect(starts).toHaveLength(2);
    expect(shotCalls).toHaveLength(2);
    expect(shotCalls[0]!.outDir).toContain(join("export", "ui-pdf", "page-1"));
    expect(shotCalls[1]!.outDir).toContain(join("export", "ui-pdf", "page-2"));
    expect(pdfCalls).toHaveLength(0);

    const composed = await PDFDocument.load(bytes);
    expect(composed.getPageCount()).toBe(2);
    expect(composed.getPage(0).getSize()).toEqual({ width: 1.5, height: 2.25 });
    expect(composed.getPage(1).getSize()).toEqual({ width: 2.25, height: 1.5 });
  });

  it("非 UI 项目 400 project_type_mismatch，且不写盘不起预览", async () => {
    const store = createProjectsStore(baseDir);
    const { app, starts, pdfCalls } = makeHarness();
    const ppt = await store.create({
      name: "汇报",
      productType: "",
      targetUsers: "",
      goal: "",
      referenceLinks: [],
      brandRules: "",
      projectType: "ppt",
    });

    const res = await app.request(`/api/projects/${ppt.meta.id}/export/ui-pdf`, { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("project_type_mismatch");
    expect(body.message).toContain("ui");
    expect(starts).toEqual([]);
    expect(pdfCalls).toEqual([]);
  });

  it("未知项目 404；非法 id 400 invalid_id；未知 mode 400 invalid_mode", async () => {
    const store = createProjectsStore(baseDir);
    const { app } = makeHarness();

    const missing = await app.request(`/api/projects/${UNKNOWN_ID}/export/ui-pdf`, { method: "POST" });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe("not_found");

    const bad = await app.request("/api/projects/not-a-uuid/export/ui-pdf", { method: "POST" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_id");

    const bundle = await createUiProject(store, "模式");
    const badMode = await app.request(
      `/api/projects/${bundle.meta.id}/export/ui-pdf?mode=zip`,
      { method: "POST" },
    );
    expect(badMode.status).toBe(400);
    expect(((await badMode.json()) as { error: string }).error).toBe("invalid_mode");
  });

  it("pdf runner 失败 503 screenshots_unavailable，消息带同一句安装指引", async () => {
    const store = createProjectsStore(baseDir);
    const failing: PdfRunner = async () => {
      throw new Error("Executable doesn't exist");
    };
    const { app } = makeHarness({ pdfRunner: failing });
    const bundle = await createUiProject(store, "引导页");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-pdf`, { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("screenshots_unavailable");
    expect(body.message).toContain("playwright install chromium");
  });

  it("multi 截图链失败 503 screenshots_unavailable（与 ui-png 同句）", async () => {
    const store = createProjectsStore(baseDir);
    const failing: ScreenshotRunner = async () => {
      throw new Error("Executable doesn't exist");
    };
    const { app } = makeHarness({ shotRunner: failing });
    const bundle = await createUiProject(store, "多页失败");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-pdf?mode=multi`, { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("screenshots_unavailable");
    expect(body.message).toContain("playwright install chromium");
  });

  it("codegen 写盘失败 500 export_failed，且不启预览", async () => {
    const store = createProjectsStore(baseDir);
    const { app, starts } = makeHarness({
      generateFiles: () => {
        throw new Error("boom");
      },
    });
    const bundle = await createUiProject(store, "坏文档");

    const res = await app.request(`/api/projects/${bundle.meta.id}/export/ui-pdf`, { method: "POST" });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("export_failed");
    expect(starts).toEqual([]);
  });

  it("经 createApp 挂载后可达（visual/routes.ts 接线），ui-png 不受影响", async () => {
    const store = createProjectsStore(baseDir);
    const { manager } = fakeManager();
    const app = createApp(store, {
      previewManager: manager,
      generateFiles: okGenerateFiles,
    });
    const ppt = await store.create({
      name: "汇报2",
      productType: "",
      targetUsers: "",
      goal: "",
      referenceLinks: [],
      brandRules: "",
      projectType: "ppt",
    });

    const res = await app.request(`/api/projects/${ppt.meta.id}/export/ui-pdf`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("project_type_mismatch");
  });
});
