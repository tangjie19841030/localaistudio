import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import JSZip from "jszip";
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
import type { ScreenshotRunner, ShotFile } from "./screenshots.js";

/**
 * W1-D UI project PNG export (roadmap §6/§7): one route,
 * POST /api/projects/:id/export/ui-png, that pipelines the existing chains —
 * codegen write-to-disk → PreviewManager vite → Playwright three-viewport
 * screenshots (desktop/tablet/mobile) → JSZip download. Error shapes follow
 * export-shared (project_type_mismatch / 404 / 400); a broken screenshot
 * chain surfaces as 503 with explicit guidance, never a silent failure
 * (roadmap OP-2).
 *
 * Mounted from visual/routes.ts (roadmap §9) so the runner/generateFiles test
 * seams injected via createApp reach this route unchanged.
 */

/** Pipeline failure inside our own phases (codegen write, zip build). */
export class UiPngExportError extends Error {}

/** Screenshot chain unavailable (Playwright/chromium missing or nav failure). */
export class ScreenshotsUnavailableError extends Error {}

export interface UiPngExportDeps {
  store: ProjectsStore;
  previewManager: PreviewManager;
  /** Test seam bypassing the schema-core generateFiles dynamic import. */
  generateFiles?: GenerateFiles;
  /** Test seam replacing Playwright; tests inject a fake so no browser starts. */
  runner: ScreenshotRunner;
}

/** Where viewport PNGs land between phases; persisted for user inspection. */
function uiPngExportDir(projectDir: string): string {
  return join(projectDir, "export", "ui-png");
}

/** Phase 1 — regenerate the vite project from the stored document. */
async function regenerateSources(
  projectDir: string,
  doc: StudioDocument,
  generateFiles?: GenerateFiles,
): Promise<void> {
  try {
    await writeGeneratedFiles(projectDir, doc, { generateFiles });
  } catch (err) {
    throw new UiPngExportError(`生成代码失败: ${(err as Error).message}`);
  }
}

interface RenderArgs {
  id: string;
  dir: string;
  doc: StudioDocument;
  previewManager: PreviewManager;
  runner: ScreenshotRunner;
  generateFiles?: GenerateFiles;
}

/**
 * Phases 1+2 — regenerate sources, ensure vite serves the project, capture
 * the three viewports into the export dir. Screenshot failures map to the
 * explicit 503 contract; generation/startup failures to export_failed 500.
 */
async function renderViewports(args: RenderArgs): Promise<ShotFile[]> {
  let port: number;
  try {
    await regenerateSources(args.dir, args.doc, args.generateFiles);
    ({ port } = await args.previewManager.start(args.id, args.dir));
  } catch (err) {
    if (err instanceof UiPngExportError) throw err;
    throw new UiPngExportError(`启动预览失败: ${(err as Error).message}`);
  }
  const outDir = uiPngExportDir(args.dir);
  await fs.mkdir(outDir, { recursive: true });
  try {
    const outcome = await args.runner({ url: `http://127.0.0.1:${port}`, outDir });
    if (outcome.shots.length === 0) {
      throw new UiPngExportError("截图链未产出任何视口图片");
    }
    return outcome.shots;
  } catch (err) {
    if (err instanceof UiPngExportError) throw err;
    throw new ScreenshotsUnavailableError(
      `Playwright 截图失败：${(err as Error).message}（首次使用请先安装浏览器：pnpm exec playwright install chromium）`,
    );
  }
}

/** Phase 3 — zip the captured viewport PNGs (files the runner wrote). */
async function zipViewportShots(outDir: string, shots: ShotFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const shot of shots) {
    zip.file(shot.file, await fs.readFile(join(outDir, shot.file)));
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

export function registerUiPngExportRoute(app: Hono, deps: UiPngExportDeps): void {
  const { store, previewManager, runner, generateFiles } = deps;

  app.post("/api/projects/:id/export/ui-png", async (c) => {
    try {
      const { id, dir } = await requireProject(c, store);
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ui") {
        return projectTypeMismatch(c, projectType, "ui");
      }
      const bundle = await store.read(id);
      const shots = await renderViewports({
        id,
        dir,
        doc: bundle.document as StudioDocument,
        previewManager,
        runner,
        generateFiles,
      });
      const zip = await zipViewportShots(uiPngExportDir(dir), shots);
      const filename = `${sanitizeArtifactBase(bundle.meta.name, id)}-ui-png.zip`;
      await saveExportArtifact(store, id, filename, zip);
      return attachmentResponse(zip, "application/zip", filename);
    } catch (err) {
      if (err instanceof ScreenshotsUnavailableError) {
        return c.json({ error: "screenshots_unavailable", message: err.message }, 503);
      }
      return exportRouteFail(c, err, UiPngExportError);
    }
  });
}
