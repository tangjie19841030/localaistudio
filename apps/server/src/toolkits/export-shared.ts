import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Context } from "hono";
import { NotFoundError, PathError, type ProjectsStore } from "../store/projects.js";
import type { OfficeCapabilities } from "../office/capabilities.js";

/**
 * Shared export-route protocol for the office toolkits (ppt + word).
 *
 * Both registerPptExportRoutes and registerWordExportRoutes used to carry
 * private copies of the same wire protocol (attachment headers, artifact
 * persistence, error mapping, office-convert tail) and had drifted: word's
 * Content-Disposition percent-encoded Chinese filenames inside a quoted
 * string (browsers saved "%E5%91%A8%E6%8A%A5.docx"), and only ppt stripped
 * Windows reserved device names. This module is the single definition both
 * domains now use; per-toolkit behavior stays in the domain routes files
 * (materializer, render command, path forwarding).
 */

/** Strip hostile characters; empty/Windows-reserved bases fall back to the id. */
export function sanitizeArtifactBase(name: string, id: string): string {
  const base = name
    .replace(/[\r\n"\\\/:*?"<>|\x00-\x1f]/g, "")
    .trim()
    .replace(/[. ]+$/g, "");
  if (base === "" || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base)) return id;
  return base;
}

/**
 * Binary attachment response. RFC 5987: filename* carries the real (Chinese)
 * name; the plain token is the ASCII fallback browsers use when the extended
 * parameter is absent.
 */
export function attachmentResponse(buffer: Buffer, mime: string, filename: string): Response {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

/** Persist a copy of the exported artifact into <project>/export/. */
export async function saveExportArtifact(
  store: ProjectsStore,
  id: string,
  filename: string,
  buffer: Buffer,
): Promise<void> {
  const dir = join(store.baseDir, id, "export");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, filename), buffer);
}

/** Write an intermediate office file into <project>/export/ and return its path. */
export async function writeIntermediateArtifact(
  store: ProjectsStore,
  id: string,
  base: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  const dir = join(store.baseDir, id, "export");
  await fs.mkdir(dir, { recursive: true });
  const artifactPath = join(dir, `${base}.${ext}`);
  await fs.writeFile(artifactPath, buffer);
  return artifactPath;
}

/** 400 project_type_mismatch with the shared message shape. */
export function projectTypeMismatch(c: Context, actual: string, expected: string): Response {
  return c.json({ error: "project_type_mismatch", message: `项目类型为 ${actual}，需要 ${expected}` }, 400);
}

/** 503 when the machine has no PowerPoint/LibreOffice (never faked). */
export function officeUnavailable(c: Context): Response {
  return c.json(
    { error: "office_unavailable", message: "本机未检测到 PowerPoint/LibreOffice，无法导出 PDF/图片" },
    503,
  );
}

/**
 * Shared error mapping for the toolkit export routes: PathError 400,
 * NotFound 404, the toolkit's own export error / OfficeRenderError 500;
 * anything else rethrows (Hono default 500).
 */
export function exportRouteFail(
  c: Context,
  err: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...exportErrorCtors: (abstract new (...args: any[]) => Error)[]
): Response {
  if (err instanceof PathError) return c.json({ error: "invalid_id" }, 400);
  if (err instanceof NotFoundError) return c.json({ error: "not_found" }, 404);
  if (exportErrorCtors.some((ctor) => err instanceof ctor)) {
    return c.json({ error: "export_failed", message: (err as Error).message }, 500);
  }
  throw err;
}

/** Materialize the toolkit's office file (export + base name). */
export type OfficeMaterializer = () => Promise<{ buffer: Buffer; base: string }>;

export interface OfficeConvertConfig {
  c: Context;
  store: ProjectsStore;
  id: string;
  /** Project type this handler owns (e.g. "ppt"). */
  expectedType: string;
  /** The sibling type registered on the same /export/pdf|png paths. */
  forwardType: string;
  detect: () => Promise<OfficeCapabilities>;
  materialize: OfficeMaterializer;
  render: (
    artifactPath: string,
    outDir: string,
    caps: OfficeCapabilities,
  ) => Promise<{ ok: true; outputPath: string } | { ok: false }>;
  ext: string;
  mime: string;
}

/**
 * Shared tail for /export/pdf|png: forward the sibling toolkit's project,
 * 400 other types, materialize the office file, convert, stream. Returning
 * undefined means "forwarded" — the route calls next().
 */
export async function convertOfficeExport(cfg: OfficeConvertConfig): Promise<Response | undefined> {
  const { c, store, id, expectedType, forwardType, detect, materialize, render, ext, mime } = cfg;
  const projectType = await store.readMetaProjectType(id);
  if (projectType === forwardType) return undefined; // sibling handler owns this path
  if (projectType !== expectedType) return projectTypeMismatch(c, projectType, expectedType);
  const { buffer, base } = await materialize();
  const artifactPath = await writeIntermediateArtifact(store, id, base, expectedType === "ppt" ? "pptx" : "docx", buffer);
  const outDir = join(store.baseDir, id, "export");
  const result = await render(artifactPath, outDir, await detect());
  if (!result.ok) return officeUnavailable(c);
  const converted = await fs.readFile(result.outputPath);
  return attachmentResponse(converted, mime, `${base}.${ext}`);
}
