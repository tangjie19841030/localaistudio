import type { Context, Hono } from "hono";
import { runWordInspectors, type WordDocument } from "@studio/word-toolkit";
import type { ProjectsStore } from "../../store/projects.js";
import { exportDocx, WordExportError } from "./exporter.js";
import { detectOfficeCapabilities, type OfficeCapabilities } from "../../office/capabilities.js";
import { OfficeRenderError, renderDocxToPdf, renderDocxToPng } from "../../office/render.js";
import {
  attachmentResponse,
  convertOfficeExport,
  exportRouteFail,
  projectTypeMismatch,
  sanitizeArtifactBase,
  saveExportArtifact,
} from "../export-shared.js";

/**
 * P10.2 export routes. Mounted by the coordinator in app.ts via
 * registerWordExportRoutes(app, { store }). Contract:
 * POST /api/projects/:id/export/docx
 * - unknown id -> 404, non-uuid -> 400, non-word project -> 400 project_type_mismatch
 * - success -> binary .docx (attachment) + a copy in <project>/export/
 * P10.2 finishing adds:
 * POST /api/projects/:id/export/pdf  (docx -> pdf via LibreOffice/Word COM; 503 office_unavailable)
 * POST /api/projects/:id/export/png  (docx -> first-page png, LibreOffice only)
 * POST /api/projects/:id/inspect/word (quality issues, JSON)
 * /export/pdf|png are registered by BOTH toolkits on one app (ppt then word):
 * when this handler sees a ppt project it calls next() so the ppt handler on
 * the same path can answer. Wire protocol helpers live in export-shared —
 * the word routes previously carried a drifted private copy whose
 * Content-Disposition mangled Chinese filenames (now unified).
 */

export interface WordExportRouteDeps {
  store: ProjectsStore;
  /** Injectable for tests; defaults to the real machine probe (60s cache). */
  detectCapabilities?: () => Promise<OfficeCapabilities>;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fail(c: Context, err: unknown): Response {
  return exportRouteFail(c, err, WordExportError, OfficeRenderError);
}

/** Materialize the saved document into a .docx buffer + sanitized download base. */
async function materializeDocx(store: ProjectsStore, id: string): Promise<{ buffer: Buffer; base: string }> {
  const meta = (await store.read(id)).meta;
  const doc = (await store.readDocument(id)) as WordDocument;
  return { buffer: await exportDocx(doc), base: sanitizeArtifactBase(meta.name, id) };
}

export function registerWordExportRoutes(app: Hono, deps: WordExportRouteDeps): void {
  const { store } = deps;
  const detect = deps.detectCapabilities ?? detectOfficeCapabilities;

  app.post("/api/projects/:id/export/docx", async (c) => {
    const id = c.req.param("id");
    try {
      // existence first (PathError/NotFoundError carry the 400/404 contract)
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "word") {
        return projectTypeMismatch(c, projectType, "word");
      }
      const { buffer, base } = await materializeDocx(store, id);
      const filename = `${base}.docx`;
      await saveExportArtifact(store, id, filename, buffer);
      return attachmentResponse(buffer, DOCX_MIME, filename);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/export/pdf", async (c, next) => {
    const id = c.req.param("id");
    try {
      const response = await convertOfficeExport({
        c, store, id, expectedType: "word", forwardType: "ppt", detect, ext: "pdf", mime: "application/pdf",
        materialize: () => materializeDocx(store, id),
        render: (docxPath, outDir, caps) => renderDocxToPdf(docxPath, outDir, caps),
      });
      if (!response) return next(); // ppt project: the ppt handler owns this path
      return response;
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/export/png", async (c, next) => {
    const id = c.req.param("id");
    try {
      const response = await convertOfficeExport({
        c, store, id, expectedType: "word", forwardType: "ppt", detect, ext: "png", mime: "image/png",
        materialize: () => materializeDocx(store, id),
        render: (docxPath, outDir, caps) => renderDocxToPng(docxPath, outDir, caps),
      });
      if (!response) return next(); // ppt project: the ppt handler owns this path
      return response;
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post("/api/projects/:id/inspect/word", async (c) => {
    const id = c.req.param("id");
    try {
      const projectType = await store.readMetaProjectType(id);
      if (projectType !== "word") {
        return projectTypeMismatch(c, projectType, "word");
      }
      const doc = (await store.readDocument(id)) as WordDocument;
      return c.json({ issues: runWordInspectors(doc), checkedAt: new Date().toISOString() });
    } catch (err) {
      return fail(c, err);
    }
  });
}
