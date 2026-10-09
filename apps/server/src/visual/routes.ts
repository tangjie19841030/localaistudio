import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { NotFoundError, PathError, type ProjectsStore } from "../store/projects.js";
import type { PreviewManager } from "../preview/processes.js";
import { jailedPath, requireProject } from "../codegen/routes.js";
import type { GenerateFiles } from "../codegen/files.js";
import { assertSafeRunId, assertSafeShotFile, snapshotsDir } from "./paths.js";
import {
  listVisualRuns,
  runVisualCheck,
  type ScreenshotRunner,
} from "./screenshots.js";
import { registerUiPngExportRoute } from "./ui-export.js";
import { registerUiPdfExportRoute } from "./ui-pdf.js";

export interface VisualRouteDeps {
  store: ProjectsStore;
  previewManager: PreviewManager;
  /** Injected seam; tests pass a fake so no browser starts. */
  runner: ScreenshotRunner;
  /** Shared codegen test seam, forwarded to the ui-png export route. */
  generateFiles?: GenerateFiles;
}

/** Same mapping as codegen/routes.ts: PathError→400, NotFound→404, rest rethrown (500). */
function fail(c: Context, err: unknown): Response {
  if (err instanceof PathError) return c.json({ error: "invalid_path" }, 400);
  if (err instanceof NotFoundError) return c.json({ error: "not_found" }, 404);
  throw err;
}

export function registerVisualRoutes(app: Hono, deps: VisualRouteDeps): void {
  const { store, previewManager, runner } = deps;

  // W1-D: UI project PNG export shares the same runner/preview seams (§9 mount).
  registerUiPngExportRoute(app, {
    store,
    previewManager,
    runner,
    generateFiles: deps.generateFiles,
  });

  // W2-B: UI project PDF export rides the same four seams; the pdf runner
  // defaults to the lazy Playwright implementation inside ui-pdf.ts.
  registerUiPdfExportRoute(app, {
    store,
    previewManager,
    runner,
    generateFiles: deps.generateFiles,
  });

  app.post("/api/projects/:id/screenshots", async (c) => {
    try {
      const { id, dir } = await requireProject(c, store);
      // Vite needs package.json + src to serve anything; same contract as preview/start.
      try {
        await fs.access(join(dir, "package.json"));
      } catch {
        return c.json(
          { error: "not_generated", message: "请先生成代码（POST /generate）再运行本地质检" },
          409,
        );
      }
      // T24c §4.4: screenshots only consume a preview the user has already started.
      // We must NOT call previewManager.start here — it would install deps online
      // and silently open the local firewall. If nothing is running, return 409
      // and let the UI prompt the user to start the preview first.
      const entry = previewManager.status().find((p) => p.projectId === id);
      if (!entry) {
        return c.json(
          {
            error: "preview_not_running",
            message: "请先启动本地项目预览，再运行本地质检",
          },
          409,
        );
      }
      const result = await runVisualCheck(dir, `http://127.0.0.1:${entry.port}`, runner);
      return c.json(result);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/projects/:id/screenshots", async (c) => {
    try {
      const { dir } = await requireProject(c, store);
      return c.json({ runs: await listVisualRuns(dir) });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/projects/:id/screenshots/:runId/:file", async (c) => {
    try {
      const { dir } = await requireProject(c, store);
      const runId = assertSafeRunId(c.req.param("runId") ?? "");
      const file = assertSafeShotFile(c.req.param("file") ?? "");
      // Belt-and-braces: names are already whitelisted, jailedPath keeps the invariant local.
      const abs = jailedPath(snapshotsDir(dir), join(runId, file));
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return c.json({ error: "not_found" }, 404);
        }
        throw err;
      }
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    } catch (err) {
      return fail(c, err);
    }
  });
}
