import { promises as fs } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Context, Hono } from "hono";
import { validateDocument, type StudioDocument } from "@studio/schema-core";
import { z } from "zod";
import { PathError, NotFoundError, DocumentInvalidError, type ProjectsStore } from "../store/projects.js";
import { writeGeneratedFiles, type GenerateFiles } from "./files.js";
import type { PreviewManager } from "../preview/processes.js";
import { exportZip, runChecks, type CheckRunner } from "./export.js";

export interface CodegenRouteDeps {
  store: ProjectsStore;
  previewManager: PreviewManager;
  /** Test seam bypassing the dynamic import of schema-core generateFiles. */
  generateFiles?: GenerateFiles;
  /** Test seam replacing subprocess execution in export checks. */
  checkRunner?: CheckRunner;
  /** Test seam: skip the install step inside runChecks. */
  skipInstall?: boolean;
}

const EXCLUDED_DIRS = new Set(["node_modules", ".vite", "dist"]);

function projectDirOf(store: ProjectsStore, id: string): string {
  return join(store.baseDir, id);
}

/** Resolve rel inside projectDir; reject traversal escapes with PathError.
 *  Exported so sibling route groups (visual/) share one guard instead of copying it. */
export function jailedPath(projectDir: string, rel: string): string {
  const abs = resolve(projectDir, rel);
  if (abs !== projectDir && !abs.startsWith(projectDir + sep)) {
    throw new PathError(`文件路径越界: "${rel}"`);
  }
  return abs;
}

/** Resolve the project id to its dir after existence/uuid checks.
 *  Exported for sibling route groups (visual/) — one existence check, one contract. */
export async function requireProject(
  c: Context,
  store: ProjectsStore,
): Promise<{ id: string; dir: string }> {
  const id = c.req.param("id") ?? "";
  await store.exists(id); // PathError→400 / NotFound→404
  return { id, dir: projectDirOf(store, id) };
}

async function listGeneratedFiles(projectDir: string): Promise<string[]> {
  const srcDir = join(projectDir, "src");
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else {
        out.push(abs.slice(projectDir.length + 1).replaceAll(sep, "/"));
      }
    }
  }
  await walk(srcDir);
  return out.sort();
}

function fail(c: Context, err: unknown): Response {
  if (err instanceof PathError) return c.json({ error: "invalid_path" }, 400);
  if (err instanceof NotFoundError) return c.json({ error: "not_found" }, 404);
  // Same contract as app.ts's fail: an invalid generate body is a 422 client error.
  if (err instanceof DocumentInvalidError) {
    return c.json({ error: "document_invalid", issues: err.issues }, 422);
  }
  throw err;
}

/** ASCII-safe download filename: fall back to the project id when nothing usable. */
function downloadSlug(name: string, id: string): string {
  const slug = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? id : slug;
}

export function registerCodegenRoutes(app: Hono, deps: CodegenRouteDeps): void {
  const { store, previewManager } = deps;

  app.post("/api/projects/:id/generate", async (c) => {
    try {
      const { id, dir } = await requireProject(c, store);
      // Optional in-memory document: unsaved canvas edits must not silently
      // generate stale code from the disk copy. Falls back to disk when absent.
      const raw = await c.req.json().catch(() => null);
      const doc = (raw as { document?: unknown } | null)?.document;
      let document: StudioDocument;
      if (doc) {
        try {
          document = validateDocument(doc);
        } catch (err) {
          // Map zod failure onto the same 422 contract as store.save — an
          // invalid in-memory document is a client error, not a server fault.
          throw new DocumentInvalidError(
            err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) : [String(err)],
          );
        }
      } else {
        document = (await store.read(id)).document as StudioDocument;
      }
      const { written, handEdited } = await writeGeneratedFiles(dir, document, {
        generateFiles: deps.generateFiles,
      });
      return c.json({ files: written, handEdited });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get("/api/projects/:id/files", async (c) => {
    try {
      const { dir } = await requireProject(c, store);
      const rel = c.req.query("path");
      if (rel === undefined) {
        return c.json({ files: await listGeneratedFiles(dir) });
      }
      const abs = jailedPath(dir, rel);
      let content: string;
      try {
        content = await fs.readFile(abs, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return c.json({ error: "not_found" }, 404);
        }
        throw err;
      }
      return c.json({ path: rel, content });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/preview/start", async (c) => {
    try {
      const { dir } = await requireProject(c, store);
      // Generate must run before preview: vite needs package.json + src.
      try {
        await fs.access(join(dir, "package.json"));
      } catch {
        return c.json({ error: "not_generated", message: "请先生成代码（POST /generate）再启动预览" }, 409);
      }
      const { port } = await previewManager.start(c.req.param("id"), dir);
      return c.json({ port });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/preview/stop", async (c) => {
    try {
      const { id } = await requireProject(c, store);
      await previewManager.stop(id);
      return c.json({ ok: true });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/checks", async (c) => {
    try {
      const { id, dir } = await requireProject(c, store);
      const bundle = await store.read(id);
      const result = await runChecks(dir, {
        runner: deps.checkRunner,
        skipInstall: deps.skipInstall,
      });
      return c.json({ checks: result });
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/export", async (c) => {
    try {
      const { id, dir } = await requireProject(c, store);
      const bundle = await store.read(id);
      const zip = await exportZip(dir);
      const filename = `${downloadSlug(bundle.meta.name, id)}.zip`;
      return new Response(new Uint8Array(zip), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (err) {
      return fail(c, err);
    }
  });
}
