import { promises as fs } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWriteJson } from "../store/atomic.js";
import {
  DocumentEnvelopeError,
  parseDocumentEnvelope,
  projectTypeSchema,
  type DocumentEnvelope,
} from "@studio/studio-core";

/**
 * Project format V2 (P7.2):
 * - document:  `<project>/document/document.json`  — a DocumentEnvelope
 * - versions:  `<project>/document/versions/<versionId>.json`
 * - `project.json` meta additionally carries projectType/toolkitId/formatVersion.
 *
 * legacy V1 (`<project>/design/document.json`, bare PageDocument) stays
 * read-compatible: `readCurrentDocument` falls back to it and reports
 * source "legacy", so callers get a read-only view and disk is never
 * rewritten by a read.
 */

export const FORMAT_VERSION = 2 as const;

const projectTypeField = projectTypeSchema.optional();

/**
 * Format block embedded in project.json. project.json itself stays a
 * free-key mirror file; this schema validates only the V2 format keys
 * (strip 模式：其余 meta 键被忽略，由 projectMetaSchema 单独校验).
 * Absent keys mean legacy V1 (defaults: ui, no toolkitId, no formatVersion) —
 * the default-filling happens in the consumer (`?? "ui"`), not here.
 */
export const projectFormatKeysSchema = z
  .object({
    projectType: projectTypeField,
    toolkitId: z.string().min(1).optional(),
    formatVersion: z.literal(FORMAT_VERSION).optional(),
  })
  .strip();

export type ProjectFormatKeys = z.infer<typeof projectFormatKeysSchema>;

/** How a project's current document reached memory（P7.2 判别联合）。 */
export type DocumentSource = "v2" | "legacy";

export interface CurrentDocument {
  source: DocumentSource;
  /** V2 only; legacy reads expose the bare document instead. */
  envelope: DocumentEnvelope | null;
  /** v2 → envelope.document；legacy → bare PageDocument（未包信封）。 */
  document: unknown;
}

export class ProjectFormatError extends Error {
  constructor(message: string, public readonly issues: string[] = []) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export function documentDir(projectDir: string): string {
  return join(projectDir, "document");
}

export function versionsDir(projectDir: string): string {
  return join(documentDir(projectDir), "versions");
}

function v2DocumentFile(projectDir: string): string {
  return join(documentDir(projectDir), "document.json");
}

function legacyDocumentFile(projectDir: string): string {
  return join(projectDir, "design", "document.json");
}

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException)?.code === code;
}

/** Write a V2 envelope to `<project>/document/document.json`（V2 专用写路径，原子替换）。 */
export async function writeEnvelope(projectDir: string, envelope: DocumentEnvelope): Promise<void> {
  await atomicWriteJson(v2DocumentFile(projectDir), envelope);
}

/** Parse the format block from a raw project.json body（缺省键 = legacy V1）。 */
export function parseFormatKeys(raw: string): ProjectFormatKeys {
  const keys = projectFormatKeysSchema.parse(JSON.parse(raw));
  return { ...keys, projectType: keys.projectType ?? "ui" };
}

/**
 * Read the project's current document.
 * V2 path first; ENOENT falls back to the legacy bare-document path
 * (`design/document.json`). Disk is never rewritten by a read.
 */
export async function readCurrentDocument(projectDir: string): Promise<CurrentDocument> {
  let body: unknown;
  try {
    body = await readJsonFile(v2DocumentFile(projectDir));
  } catch (err) {
    if (isErrno(err, "ENOENT")) {
      const legacy = await readJsonFile(legacyDocumentFile(projectDir));
      return { source: "legacy", envelope: null, document: legacy };
    }
    if (err instanceof SyntaxError) {
      throw new ProjectFormatError("项目文档损坏", [err.message]); // 坏 JSON 统一为损坏语义
    }
    throw err;
  }
  try {
    const envelope = parseDocumentEnvelope(body);
    return { source: "v2", envelope, document: envelope.document };
  } catch (err) {
    if (err instanceof DocumentEnvelopeError || err instanceof SyntaxError) {
      throw new ProjectFormatError("项目文档损坏", [String((err as Error).message ?? err)]);
    }
    throw err;
  }
}

export function versionFile(projectDir: string, versionId: string): string {
  return join(versionsDir(projectDir), `${versionId}.json`);
}

