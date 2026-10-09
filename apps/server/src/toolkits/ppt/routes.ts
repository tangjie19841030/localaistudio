import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { runPptInspectors, type PptDocument } from "@studio/ppt-toolkit";
import type { ProjectsStore } from "../../store/projects.js";
import { exportPptx, PptExportError } from "./exporter.js";
import { mergeImportedSlides, parsePptx, PptImportError, randomImportNonce } from "./importer.js";
import { ASSET_FILE_RE, listProjectAssets, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, PptAssetError, referencedAssetFiles, saveProjectImage, saveProjectVideo } from "./assets.js";
import { jailedPath } from "../../codegen/routes.js";
import { PayloadTooLargeError, readLimitedBody } from "../../http/limitedBody.js";
import { detectOfficeCapabilities, type OfficeCapabilities } from "../../office/capabilities.js";
import { OfficeRenderError, renderPptxToPdf, renderPptxToPng } from "../../office/render.js";
import {
  attachmentResponse,
  convertOfficeExport,
  exportRouteFail,
  officeUnavailable,
  projectTypeMismatch,
  sanitizeArtifactBase,
  saveExportArtifact,
} from "../export-shared.js";

/**
 * P9.2 export routes. Mounted by the coordinator in app.ts via
 * registerPptExportRoutes(app, { store }) — see the handoff note in the
 * parallel task report. Contract:
 * POST /api/projects/:id/export/pptx
 * - unknown id -> 404, non-uuid -> 400, non-ppt project -> 400 project_type_mismatch
 * - success -> binary .pptx (attachment) + a copy in <project>/export/
 * P9.2 finishing adds:
 * POST /api/projects/:id/export/pdf  (pptx -> pdf, Office-dependent; 503 office_unavailable)
 * POST /api/projects/:id/export/png  (pptx -> first-slide png, same contract)
 * POST /api/projects/:id/inspect/ppt (quality issues, JSON)
 * /export/pdf|png are registered by BOTH toolkits on one app (ppt then word):
 * when this handler sees a word project it calls next() so the word handler
 * on the same path can answer. Wire protocol helpers live in export-shared.
 */

export interface PptExportRouteDeps {
  store: ProjectsStore;
  /** Injectable for tests; defaults to the real machine probe (60s cache). */
  detectCapabilities?: () => Promise<OfficeCapabilities>;
}

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const OCTET_STREAM = "application/octet-stream";
const MAX_PPTX_BYTES = 50 * 1024 * 1024;

const ASSET_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Resolve imported asset URLs (/api/projects/<id>/assets/<sha>.<ext>) to
 * embedded data URLs so re-exporting an imported deck keeps its images.
 * Injected into exportPptx for both pptx and office pdf/png renders.
 */
function createProjectImageResolver(store: ProjectsStore, id: string) {
  const prefix = `/api/projects/${id}/assets/`;
  return async (src: string): Promise<string | null> => {
    if (!src.startsWith(prefix)) return null;
    const file = src.slice(prefix.length);
    if (!ASSET_FILE_RE.test(file)) return null;
    try {
      const abs = jailedPath(join(store.baseDir, id), join("assets", file));
      const bytes = await fs.readFile(abs);
      const ext = file.split(".").pop() ?? "";
      return `data:${ASSET_MIME[ext] ?? "application/octet-stream"};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  };
}

function fail(c: Context, err: unknown): Response {
  return exportRouteFail(c, err, PptExportError, OfficeRenderError);
}

/** Materialize the saved deck into a .pptx buffer + sanitized download base. */
async function materializePptx(store: ProjectsStore, id: string): Promise<{ buffer: Buffer; base: string }> {
  const meta = (await store.read(id)).meta;
  const doc = (await store.readDocument(id)) as PptDocument;
  const buffer = await exportPptx(doc, { resolveImageSrc: createProjectImageResolver(store, id) });
  return { buffer, base: sanitizeArtifactBase(meta.name, id) };
}

export function registerPptExportRoutes(app: Hono, deps: PptExportRouteDeps): void {
  const { store } = deps;
  const detect = deps.detectCapabilities ?? detectOfficeCapabilities;

  app.post("/api/projects/:id/export/pptx", async (c) => {
    const id = c.req.param("id");
    try {
      // existence first (PathError/NotFoundError carry the 400/404 contract)
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ppt") {
        return projectTypeMismatch(c, projectType, "ppt");
      }
      const { buffer, base } = await materializePptx(store, id);
      const filename = `${base}.pptx`;
      await saveExportArtifact(store, id, filename, buffer);
      return attachmentResponse(buffer, PPTX_MIME, filename);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/export/pdf", async (c, next) => {
    const id = c.req.param("id");
    try {
      const response = await convertOfficeExport({
        c, store, id, expectedType: "ppt", forwardType: "word", detect, ext: "pdf", mime: "application/pdf",
        materialize: () => materializePptx(store, id),
        render: (pptxPath, outDir, caps) => renderPptxToPdf(pptxPath, outDir, caps),
      });
      if (!response) return next(); // word project: the word handler owns this path
      return response;
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/export/png", async (c, next) => {
    const id = c.req.param("id");
    try {
      const response = await convertOfficeExport({
        c, store, id, expectedType: "ppt", forwardType: "word", detect, ext: "png", mime: "image/png",
        materialize: () => materializePptx(store, id),
        render: (pptxPath, outDir, caps) => renderPptxToPng(pptxPath, outDir, caps),
      });
      if (!response) return next(); // word project: the word handler owns this path
      return response;
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/inspect/ppt", async (c) => {
    const id = c.req.param("id");
    try {
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ppt") {
        return projectTypeMismatch(c, projectType, "ppt");
      }
      const doc = (await store.readDocument(id)) as PptDocument;
      return c.json({ issues: runPptInspectors(doc), checkedAt: new Date().toISOString() });
    } catch (err) {
      return fail(c, err);
    }
  });

  // -------------------------------------------------------------------------
  // PPTX import: raw body (application/octet-stream), mode=replace|append.
  // Parses to PptDocument + writes media assets; the document itself is NOT
  // persisted here — the workbench saves it through the normal PUT path.
  // -------------------------------------------------------------------------
  app.post("/api/projects/:id/import/pptx", async (c) => {
    const id = c.req.param("id") ?? "";
    try {
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ppt") return projectTypeMismatch(c, projectType, "ppt");
      const mode = c.req.query("mode") ?? "replace";
      if (mode !== "replace" && mode !== "append") {
        return c.json({ error: "invalid_mode", message: "mode 只能是 replace 或 append" }, 400);
      }
      let buffer: Buffer;
      try {
        // Hard streaming cap — a forged Content-Length:0 previously skipped the
        // check and the full body was buffered unbounded.
        buffer = await readLimitedBody(c.req.raw, MAX_PPTX_BYTES);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          return c.json({ error: "payload_too_large", message: "文件超过 50MB 上限" }, 413);
        }
        throw err;
      }
      if (buffer.length === 0) {
        return c.json({ error: "import_failed", message: "上传内容为空" }, 400);
      }

      const meta = (await store.read(id)).meta;
      const parsed = await parsePptx(buffer, {
        name: meta.name,
        assetBaseUrl: `/api/projects/${id}/assets`,
      });

      // Build the final document BEFORE touching disk: a failed append merge
      // (validation error) must not orphan media files under /assets.
      const warnings = [...parsed.warnings];
      let document = parsed.document;
      if (mode === "append") {
        const current = (await store.readDocument(id)) as PptDocument;
        const merged = mergeImportedSlides(current, parsed.document, randomImportNonce());
        document = merged.document;
        warnings.push(...merged.warnings);
      } else {
        document = { ...parsed.document, name: meta.name };
      }

      // Persist only content-hash assets the final document actually references
      // (duplicates across imports are skipped once equal bytes exist).
      const referenced = referencedAssetFiles(document);
      const assetsDir = join(store.baseDir, id, "assets");
      await fs.mkdir(assetsDir, { recursive: true });
      let writtenAssets = 0;
      await Promise.all(
        parsed.assets.map(async (asset) => {
          const file = `${asset.sha1}.${asset.ext}`;
          if (!referenced.has(file)) return;
          const target = join(assetsDir, file);
          try {
            await fs.access(target);
          } catch {
            await fs.writeFile(target, asset.data);
            writtenAssets += 1;
          }
        }),
      );
      return c.json({
        document,
        warnings,
        imported: { slides: parsed.document.slides.length, assets: writtenAssets },
      });
    } catch (err) {
      if (err instanceof PptImportError) {
        return c.json({ error: "import_failed", message: err.message }, 400);
      }
      return fail(c, err);
    }
  });

  // -------------------------------------------------------------------------
  // Standalone media upload: one raster image or video (octet-stream) →
  // project asset. Gives users a way to provide the AI with real images
  // (backgrounds, photos) and videos, and powers the manual "insert/replace
  // image/video" editor actions. Query param kind=video selects the video
  // branch (200MB cap); the default stays image (20MB) so the image limit is
  // never silently widened.
  // -------------------------------------------------------------------------
  app.post("/api/projects/:id/assets", async (c) => {
    const id = c.req.param("id") ?? "";
    const isVideo = c.req.query("kind") === "video";
    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    const tooLargeMessage = isVideo ? "视频超过 200MB 上限" : "图片超过 20MB 上限";
    try {
      // Image assets serve both PPT and Word (AI image blocks) projects.
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ppt" && projectType !== "word") {
        return projectTypeMismatch(c, projectType, "ppt/word");
      }
      let buffer: Buffer;
      try {
        // Hard streaming cap — Content-Length is forgeable/chunked omits it.
        buffer = await readLimitedBody(c.req.raw, maxBytes);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          return c.json({ error: "payload_too_large", message: tooLargeMessage }, 413);
        }
        throw err;
      }
      const saved = isVideo
        ? await saveProjectVideo(store, id, buffer)
        : await saveProjectImage(store, id, buffer);
      return c.json({
        src: saved.src,
        sha1: saved.sha1,
        ext: saved.ext,
        contentType: saved.contentType,
        bytes: saved.bytes,
      });
    } catch (err) {
      if (err instanceof PptAssetError) {
        return c.json({ error: isVideo ? "unsupported_video" : "unsupported_image", message: err.message }, 400);
      }
      return fail(c, err);
    }
  });

  /** List a project's image assets (AI prompt context + future asset pickers). */
  app.get("/api/projects/:id/assets", async (c) => {
    const id = c.req.param("id") ?? "";
    try {
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "ppt" && projectType !== "word") {
        return projectTypeMismatch(c, projectType, "ppt/word");
      }
      const assets = await listProjectAssets(store, id);
      return c.json({ assets });
    } catch (err) {
      return fail(c, err);
    }
  });

  /** Imported/generated project assets: hash-named, whitelisted, immutable
   *  cache. U7 ui projects share this chain (image-gen persists via
   *  saveProjectImage): this GET deliberately has NO project-type gate —
   *  ASSET_FILE_RE (40-hex sha1 + image/video extension) plus jailedPath is
   *  the whole security boundary, so any existing project type may read.
   *  (The POST upload and GET list routes stay ppt/word-gated above.) */
  app.get("/api/projects/:id/assets/:file", async (c) => {
    const id = c.req.param("id") ?? "";
    const file = c.req.param("file") ?? "";
    try {
      await store.exists(id); // PathError→400 / NotFound→404
      if (!ASSET_FILE_RE.test(file)) return c.json({ error: "not_found" }, 404);
      const abs = jailedPath(join(store.baseDir, id), join("assets", file));
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(abs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return c.json({ error: "not_found" }, 404);
        throw err;
      }
      const ext = file.split(".").pop() ?? "";
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": ASSET_MIME[ext] ?? OCTET_STREAM,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch (err) {
      return fail(c, err);
    }
  });
}
