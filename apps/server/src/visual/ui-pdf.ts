import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import type { StudioDocument } from "@studio/schema-core";
import type { ProjectsStore } from "../store/projects.js";
import { writeGeneratedFiles, type GenerateFiles } from "../codegen/files.js";
import { requireProject } from "../codegen/routes.js";
import type { PreviewManager } from "../preview/processes.js";
import {
  attachmentResponse,
  exportRouteFail,
  projectTypeMismatch,
  sanitizeArtifactBase,
  saveExportArtifact,
} from "../toolkits/export-shared.js";
import type { ScreenshotRunner, ShotOutcome } from "./screenshots.js";
import { ScreenshotsUnavailableError } from "./ui-export.js";

/**
 * W2-B UI project PDF export (roadmap §6, OP-3/OP-4/OP-5): one route,
 * POST /api/projects/:id/export/ui-pdf?mode=single|multi.
 *
 * single (default): regenerate the whole vite project from the stored document
 * and print it with Playwright `page.pdf({ printBackground: true })` — the
 * generated app renders pages[0] (codegen scaffold contract), so "single" means
 * "the project the document's first page lives in" (OP-3: no pageId is
 * accepted because this wave ships no per-page route).
 * multi: per page, regenerate a single-page project, ensure vite serves it and
 * capture one full-page PNG through the injected ScreenshotRunner (W1-D chain),
 * then compose those PNGs into one PDF with pdf-lib (OP-4 default; jsPDF not
 * needed). Page boxes are the PNG pixel size at 96dpi → points, so nothing is
 * clipped or upscaled.
 *
 * Error contract is byte-identical to ui-png (ui-export.ts): the same
 * project_type_mismatch / 404 / 400 / export_failed 500 / 503
 * screenshots_unavailable, including the shared chromium install hint.
 *
 * Mounted from visual/routes.ts (§5 T50) so the runner/preview/generateFiles
 * seams injected via createApp reach this route unchanged. No workbench button
 * this wave (OP-5): the route is exercised by curl/fetch and contract tests.
 */

/** Pipeline failure inside our own phases (codegen write, missing artifact). */
export class UiPdfExportError extends Error {}

/**
 * Injected seam for the single-page print. The runner owns the browser AND
 * writes the PDF bytes to `outFile`; tests inject a fake that writes real
 * `%PDF-` bytes so no browser ever starts.
 */
export type PdfRunner = (req: { url: string; outFile: string }) => Promise<void>;

export interface UiPdfExportDeps {
  store: ProjectsStore;
  previewManager: PreviewManager;
  /** Test seam bypassing the schema-core generateFiles dynamic import. */
  generateFiles?: GenerateFiles;
  /** Test seam replacing Playwright screenshots (multi mode); fake in tests. */
  runner: ScreenshotRunner;
  /** Test seam replacing Playwright page.pdf (single mode); real one is lazy. */
  pdfRunner?: PdfRunner;
}

/** Query ?mode=; unknown values are rejected instead of silently defaulting. */
export type UiPdfMode = "single" | "multi";

/** Per-navigation budget, same as screenshots.ts. */
const NAV_TIMEOUT_MS = 30_000;

/** CSS pixel (96dpi) → PDF point (72dpi). */
const PX_TO_PT = 72 / 96;

/** Shared chromium guidance — the exact sentence ui-png's 503 carries. */
const CHROMIUM_HINT = "（首次使用请先安装浏览器：pnpm exec playwright install chromium）";

const SINGLE_PDF_FILE = "ui.pdf";

/** Where PDF artifacts land between phases; persisted for user inspection. */
function uiPdfExportDir(projectDir: string): string {
  return join(projectDir, "export", "ui-pdf");
}

/** Reads ?mode=; null means "not a supported value" (route answers 400). */
function parseMode(raw: string | undefined): UiPdfMode | null {
  if (raw === undefined || raw === "" || raw === "single") return "single";
  if (raw === "multi") return "multi";
  return null;
}

/** Phase 1 — regenerate the vite project from the document handed to this run. */
async function regenerateSources(
  projectDir: string,
  doc: StudioDocument,
  generateFiles?: GenerateFiles,
): Promise<void> {
  try {
    await writeGeneratedFiles(projectDir, doc, { generateFiles });
  } catch (err) {
    throw new UiPdfExportError(`生成代码失败: ${(err as Error).message}`);
  }
}

/** Phase 2 — ensure vite serves the project (start is idempotent). */
async function startPreview(
  id: string,
  dir: string,
  previewManager: PreviewManager,
): Promise<number> {
  try {
    const { port } = await previewManager.start(id, dir);
    return port;
  } catch (err) {
    throw new UiPdfExportError(`启动预览失败: ${(err as Error).message}`);
  }
}

/** Reads a phase artifact; a missing file is our own fault → export_failed. */
async function readArtifact(file: string, label: string): Promise<Buffer> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    throw new UiPdfExportError(`${label}未产出文件：${file}（${(err as Error).message}）`);
  }
}

/** pdf runner failure = the same chromium-missing 503 contract as ui-png. */
async function runPdfRunner(pdfRunner: PdfRunner, url: string, outFile: string): Promise<void> {
  try {
    await pdfRunner({ url, outFile });
  } catch (err) {
    if (err instanceof UiPdfExportError) throw err;
    throw new ScreenshotsUnavailableError(
      `Playwright PDF 渲染失败：${(err as Error).message}${CHROMIUM_HINT}`,
    );
  }
}

/** Screenshot chain failure — message identical to ui-export's renderViewports. */
async function runScreenshotRunner(
  runner: ScreenshotRunner,
  url: string,
  outDir: string,
): Promise<ShotOutcome> {
  try {
    const outcome = await runner({ url, outDir });
    if (outcome.shots.length === 0) {
      throw new UiPdfExportError("截图链未产出任何视口图片");
    }
    return outcome;
  } catch (err) {
    if (err instanceof UiPdfExportError) throw err;
    throw new ScreenshotsUnavailableError(
      `Playwright 截图失败：${(err as Error).message}${CHROMIUM_HINT}`,
    );
  }
}

/** The runner captures three viewports; the PDF takes the desktop full page. */
function pickFullPageShot(outcome: ShotOutcome): string {
  const desktop = outcome.shots.find((shot) => shot.viewport === "desktop");
  return (desktop ?? outcome.shots[0]!).file;
}

interface PdfPipelineArgs {
  id: string;
  dir: string;
  doc: StudioDocument;
  previewManager: PreviewManager;
  runner: ScreenshotRunner;
  pdfRunner: PdfRunner;
  generateFiles?: GenerateFiles;
}

/** single: print the whole project (its app renders pages[0]). */
async function singlePagePdf(args: PdfPipelineArgs): Promise<Buffer> {
  await regenerateSources(args.dir, args.doc, args.generateFiles);
  const port = await startPreview(args.id, args.dir, args.previewManager);
  const outDir = uiPdfExportDir(args.dir);
  await fs.mkdir(outDir, { recursive: true });
  const outFile = join(outDir, SINGLE_PDF_FILE);
  await runPdfRunner(args.pdfRunner, `http://127.0.0.1:${port}`, outFile);
  return readArtifact(outFile, "PDF");
}

/** multi, per page: single-page project → screenshot → full-page PNG bytes. */
async function capturePagePng(
  args: PdfPipelineArgs,
  pageIndex: number,
): Promise<Buffer> {
  const page = args.doc.pages[pageIndex]!;
  await regenerateSources(args.dir, { ...args.doc, pages: [page] }, args.generateFiles);
  const port = await startPreview(args.id, args.dir, args.previewManager);
  const outDir = join(uiPdfExportDir(args.dir), `page-${pageIndex + 1}`);
  await fs.mkdir(outDir, { recursive: true });
  const outcome = await runScreenshotRunner(args.runner, `http://127.0.0.1:${port}`, outDir);
  return readArtifact(join(outDir, pickFullPageShot(outcome)), `第 ${pageIndex + 1} 页截图`);
}

/** Composes one PDF page per PNG; page box = pixel size × 72/96 (no clipping). */
async function composePdf(pngs: Buffer[]): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const png of pngs) {
    const image = await out.embedPng(png);
    const page = out.addPage([image.width * PX_TO_PT, image.height * PX_TO_PT]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return Buffer.from(await out.save());
}

/** multi: every page rendered on its own, PNGs embedded in document order. */
async function multiPagePdf(args: PdfPipelineArgs): Promise<Buffer> {
  const pngs: Buffer[] = [];
  for (let index = 0; index < args.doc.pages.length; index += 1) {
    pngs.push(await capturePagePng(args, index));
  }
  return composePdf(pngs);
}

/**
 * Real pdf runner: launches ONE headless chromium per export, navigates and
 * prints. playwright-core is imported lazily so constructing the runner costs
 * nothing and starts nothing (mirrors createPlaywrightRunner).
 */
export function createPlaywrightPdfRunner(): PdfRunner {
  return async ({ url, outFile }) => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
      await page.pdf({ path: outFile, printBackground: true });
    } finally {
      await browser.close();
    }
  };
}

export function registerUiPdfExportRoute(app: Hono, deps: UiPdfExportDeps): void {
  const { store, previewManager, runner, generateFiles } = deps;
  const pdfRunner = deps.pdfRunner ?? createPlaywrightPdfRunner();

  app.post("/api/projects/:id/export/ui-pdf", async (c) => {
    try {
      const { id, dir } = await requireProject(c, store);
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ui") {
        return projectTypeMismatch(c, projectType, "ui");
      }
      const mode = parseMode(c.req.query("mode"));
      if (mode === null) {
        return c.json(
          {
            error: "invalid_mode",
            message: `mode 仅支持 single|multi，收到 "${c.req.query("mode") ?? ""}"`,
          },
          400,
        );
      }
      const bundle = await store.read(id);
      const args: PdfPipelineArgs = {
        id,
        dir,
        doc: bundle.document as StudioDocument,
        previewManager,
        runner,
        pdfRunner,
        generateFiles,
      };
      const pdf = mode === "multi" ? await multiPagePdf(args) : await singlePagePdf(args);
      const filename = `${sanitizeArtifactBase(bundle.meta.name, id)}-ui-pdf.pdf`;
      await saveExportArtifact(store, id, filename, pdf);
      return attachmentResponse(pdf, "application/pdf", filename);
    } catch (err) {
      if (err instanceof ScreenshotsUnavailableError) {
        return c.json({ error: "screenshots_unavailable", message: err.message }, 503);
      }
      return exportRouteFail(c, err, UiPdfExportError);
    }
  });
}
