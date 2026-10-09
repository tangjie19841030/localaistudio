import type { NewProjectInput, ProjectMeta, StudioDocument } from "@studio/schema-core";
import type { api as studioApi, TemplateGalleryItem } from "../../api/client";

/** Api surface the create flow needs; injected so callers/tests can stub it. */
export type CreateFlowApi = Pick<typeof studioApi, "createProject" | "saveProject" | "importPptx">;

/** Raw form field values, exactly as typed by the user (no trimming here). */
export interface CreateFormFields {
  name: string;
  productType: string;
  targetUsers: string;
  goal: string;
  referenceLinks: string;
  brandRules: string;
  projectType: ProjectMeta["projectType"];
}

/** State writers the flow needs from the owning component. */
export interface CreateFlowSetters {
  onCreated: (id: string) => void;
  setError: (message: string | null) => void;
  setSubmitting: (value: boolean) => void;
  setImportWarnings: (warnings: string[]) => void;
  setBlankProjectId: (id: string | null) => void;
  setBlankMeta: (meta: ProjectMeta | null) => void;
  setImportRetry: (retry: ImportedRetryContext | null) => void;
}

/** What kind of content a failed import left behind, so the failover card
 *  can offer the right retry. */
export type ImportRetryKind = "pptx" | "screenshot";

/** Saved on failure so "retry" can save the ALREADY-CONVERTED document into
 *  the SAME blank project instead of re-running vision conversion. */
export interface ImportedRetryContext {
  kind: ImportRetryKind;
  document: StudioDocument; // converted doc (screenshot path) — never re-converted
  warnings: string[];
}

/** Submit/retry context: setters plus the current form-selected template/pptx. */
export interface SubmitContext extends CreateFlowSetters {
  api: CreateFlowApi;
  selected: TemplateGalleryItem | null;
  pptxFile: File | null;
  blankProjectId: string | null;
  blankMeta: ProjectMeta | null;
}

/** Screenshot-import context (no template/pptx involved). */
export interface ImportedContext extends CreateFlowSetters {
  api: CreateFlowApi;
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; id: string | null; message: string; meta?: ProjectMeta };

/** Invalid reference links: surfaced as a form error instead of a payload. */
export type BuildInputResult = { input: NewProjectInput } | { error: string };

const LINK_ERROR = "参考链接需为 http(s) 开头，最多 10 条，每行一条";

/** Normalize an unknown thrown value into the display string the form shows. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shared create payload for submit + screenshot import; invalid links yield an error. */
export function buildInput(fields: CreateFormFields): BuildInputResult {
  const links = fields.referenceLinks
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (links.length > 10) return { error: LINK_ERROR };
  for (const l of links) {
    if (!/^https?:\/\//i.test(l)) return { error: LINK_ERROR };
  }
  return {
    input: {
      name: fields.name.trim(),
      productType: fields.productType,
      targetUsers: fields.targetUsers,
      goal: fields.goal,
      referenceLinks: links,
      brandRules: fields.brandRules,
      projectType: fields.projectType,
    },
  };
}

/**
 * Apply a chosen template / pptx into an EXISTING blank project. Split out so
 * the failure UI can retry against the same id instead of creating another
 * orphan project.
 */
export async function populateProject(
  api: CreateFlowApi,
  id: string,
  meta: ProjectMeta,
  input: NewProjectInput,
  template: TemplateGalleryItem | null,
  pptxFile: File | null,
  onWarnings?: (warnings: string[]) => void,
): Promise<void> {
  if (template && input.projectType === "ui") {
    await api.saveProject(id, {
      meta,
      // A gallery document is named for its reusable template. Once it is
      // attached to a project, the document identity follows the project name
      // shown in the workbench title bar.
      document: { ...template.document, name: meta.name },
    });
  }
  if (pptxFile && input.projectType === "ppt") {
    const result = await api.importPptx(id, pptxFile, "replace");
    onWarnings?.(result.warnings);
    await api.saveProject(id, { meta, document: result.document });
  }
}

/** Create the project, then land the chosen template through the save path. */
export async function createProjectWithTemplate(
  api: CreateFlowApi,
  input: NewProjectInput,
  template: TemplateGalleryItem | null,
  pptxFile: File | null,
  onWarnings?: (warnings: string[]) => void,
): Promise<CreateResult> {
  let bundle;
  try {
    bundle = await api.createProject(input);
  } catch (err) {
    return { ok: false, id: null, message: errorMessage(err) };
  }
  try {
    await populateProject(api, bundle.meta.id, bundle.meta, input, template, pptxFile, onWarnings);
    return { ok: true, id: bundle.meta.id };
  } catch (err) {
    // The blank project exists on disk — hand its id/meta back so the UI can
    // offer "open it and retry inside" or "delete it" instead of orphaning.
    return { ok: false, id: bundle.meta.id, meta: bundle.meta, message: errorMessage(err) };
  }
}

/** Create + land flow behind the submit button; retries the blank project if one exists. */
export async function submit(fields: CreateFormFields, ctx: SubmitContext): Promise<void> {
  const { setError, setSubmitting, setImportWarnings, setBlankProjectId, setBlankMeta, onCreated } = ctx;
  setSubmitting(true);
  setError(null);
  const built = buildInput(fields);
  if ("error" in built) {
    setError(built.error);
    setSubmitting(false);
    return;
  }
  setImportWarnings([]);
  try {
    let result: CreateResult;
    if (ctx.blankProjectId && ctx.blankMeta) {
      // Retry populating the SAME blank project — never create a 2nd orphan.
      try {
        await populateProject(ctx.api, ctx.blankProjectId, ctx.blankMeta, built.input, ctx.selected, ctx.pptxFile, setImportWarnings);
        result = { ok: true, id: ctx.blankProjectId };
      } catch (err) {
        result = { ok: false, id: ctx.blankProjectId, message: errorMessage(err) };
      }
    } else {
      result = await createProjectWithTemplate(ctx.api, built.input, ctx.selected, ctx.pptxFile, setImportWarnings);
    }
    if (result.ok) {
      onCreated(result.id);
    } else {
      setError(result.message);
      if (result.id) {
        setBlankProjectId(result.id);
        if (result.meta) setBlankMeta(result.meta);
      }
    }
  } finally {
    setSubmitting(false);
  }
}

/**
 * Retry a failed screenshot import: saveProject the ALREADY-CONVERTED document
 * into the existing blank project. Mirrors populateProject's
 * retry-against-same-id contract — vision conversion is never re-run.
 */
export async function retrySaveImported(
  api: CreateFlowApi,
  ctx: SubmitContext,
  retry: ImportedRetryContext,
): Promise<void> {
  const { setError, setSubmitting, setImportRetry, onCreated } = ctx;
  // The button is only rendered with a live blank project; guard anyway.
  if (!ctx.blankProjectId || !ctx.blankMeta) return;
  const id = ctx.blankProjectId;
  setSubmitting(true);
  setError(null);
  try {
    await api.saveProject(id, {
      meta: ctx.blankMeta,
      document: { ...retry.document, name: ctx.blankMeta.name },
    });
    setImportRetry(null);
    onCreated(id);
  } catch (err) {
    setError(errorMessage(err));
  } finally {
    setSubmitting(false);
  }
}

/** Screenshot import (T49): create → saveProject → onCreated, keeping the failover anchors on failure. */
export async function handleImported(
  document: StudioDocument,
  warnings: string[],
  fields: CreateFormFields,
  ctx: ImportedContext,
): Promise<void> {
  const { setError, setSubmitting, setImportWarnings, setBlankProjectId, setBlankMeta, setImportRetry, onCreated } = ctx;
  setSubmitting(true);
  setError(null);
  const built = buildInput(fields);
  if ("error" in built) {
    setError(built.error);
    setSubmitting(false);
    return;
  }
  setImportWarnings(warnings);
  let bundle: Awaited<ReturnType<CreateFlowApi["createProject"]>> | null = null;
  try {
    bundle = await ctx.api.createProject(built.input);
    await ctx.api.saveProject(bundle.meta.id, {
      meta: bundle.meta,
      document: { ...document, name: built.input.name },
    });
    setImportRetry(null);
    onCreated(bundle.meta.id);
  } catch (err) {
    setError(errorMessage(err));
    if (bundle !== null) {
      // Blank project exists but the converted doc never landed — keep the
      // document locally so retry saves it without re-running vision.
      setBlankProjectId(bundle.meta.id);
      setBlankMeta(bundle.meta);
      setImportRetry({ kind: "screenshot", document, warnings });
    }
  } finally {
    setSubmitting(false);
  }
}
