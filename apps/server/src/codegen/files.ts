import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { StudioDocument } from "@studio/schema-core";
import { collectDocTypes, readKitSources } from "./kit.js";

/**
 * generateFiles lives in schema-core (P3-1, developed in parallel). Resolved
 * lazily via dynamic import so this module compiles/works before the real
 * generator lands; tests inject a stub through `generateFilesFactory`.
 */
export type GenerateFiles = (
  doc: StudioDocument,
  kitSources: Map<string, string>,
) => Promise<Map<string, string>> | Map<string, string>;

export interface WriteFilesOptions {
  /** Test seam: replace the dynamic import of schema-core generateFiles. */
  generateFiles?: GenerateFiles;
}

export interface WriteFilesResult {
  written: string[];
  /**
   * Files that existed on disk, differed from the last generation manifest,
   * and were overwritten this run (user hand-edits lost — A3 visibility).
   */
  handEdited: string[];
}

/** Path → sha256 of content as of the last successful generate. */
const MANIFEST_REL = ".studio/generated-manifest.json";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function loadManifest(projectDir: string): Promise<Map<string, string>> {
  try {
    const raw = await fs.readFile(join(projectDir, MANIFEST_REL), "utf8");
    const parsed = JSON.parse(raw) as { files?: Record<string, string> };
    return new Map(Object.entries(parsed.files ?? {}));
  } catch {
    return new Map();
  }
}

async function saveManifest(projectDir: string, files: Map<string, string>): Promise<void> {
  const abs = join(projectDir, MANIFEST_REL);
  await fs.mkdir(dirname(abs), { recursive: true });
  const body = JSON.stringify(
    { version: 1, files: Object.fromEntries(files) },
    null,
    2,
  );
  await fs.writeFile(abs, body, "utf8");
}

/** Read a file under projectDir; ENOENT → null. */
async function readOrNull(projectDir: string, rel: string): Promise<string | null> {
  try {
    return await fs.readFile(join(projectDir, rel), "utf8");
  } catch {
    return null;
  }
}

/**
 * Detect hand-edits: a path is hand-edited when the ON-DISK content hash
 * differs from the last generation manifest. Files never recorded in the
 * manifest (first generate, or user-added under src/) also count when they
 * sit under src/ (custom/ is excluded — it is user extension space by design).
 */
async function detectHandEdits(
  projectDir: string,
  manifest: Map<string, string>,
): Promise<string[]> {
  const handEdited: string[] = [];
  for (const [rel, expected] of manifest) {
    if (rel.startsWith("src/components/custom/")) continue;
    const actual = await readOrNull(projectDir, rel);
    if (actual === null) continue; // deleted — not an overwrite of a hand-edit
    if (sha256(actual) !== expected) handEdited.push(rel);
  }
  return handEdited.sort();
}

async function loadGenerateFiles(): Promise<GenerateFiles> {
  const mod = (await import("@studio/schema-core")) as {
    generateFiles?: GenerateFiles;
  };
  if (typeof mod.generateFiles !== "function") {
    throw new Error(
      "schema-core 未导出 generateFiles：P3-1 生成器尚未就绪，无法落盘生成代码",
    );
  }
  return mod.generateFiles;
}

/** Snapshot of src/components/custom/ contents, keyed by relative path. */
async function backupCustomDir(projectDir: string): Promise<Map<string, string>> {
  const backup = new Map<string, string>();
  const customDir = join(projectDir, "src", "components", "custom");
  let files: string[] = [];
  try {
    files = await fs.readdir(customDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return backup;
    throw err;
  }
  for (const name of files) {
    backup.set(name, await fs.readFile(join(customDir, name), "utf8"));
  }
  return backup;
}

async function restoreCustomDir(projectDir: string, backup: Map<string, string>): Promise<void> {
  if (backup.size === 0) return;
  const customDir = join(projectDir, "src", "components", "custom");
  await fs.mkdir(customDir, { recursive: true });
  for (const [name, content] of backup) {
    await fs.writeFile(join(customDir, name), content, "utf8");
  }
}

/**
 * Write the generated file tree into the project dir.
 * src/ is wiped (regenerated output is the truth) except src/components/custom/
 * which is user extension space and never touched; root scaffold files like
 * package.json overwrite in place. Returns the sorted list of written paths
 * plus any hand-edited files that this overwrite destroyed.
 */
export async function writeGeneratedFiles(
  projectDir: string,
  doc: StudioDocument,
  opts?: WriteFilesOptions,
): Promise<WriteFilesResult> {
  const generate = opts?.generateFiles ?? (await loadGenerateFiles());
  const { sources } = await readKitSources(collectDocTypes(doc));
  const files = await generate(doc, sources);

  const manifest = await loadManifest(projectDir);
  const handEdited = await detectHandEdits(projectDir, manifest);

  const customBackup = await backupCustomDir(projectDir);
  await fs.rm(join(projectDir, "src"), { recursive: true, force: true });

  const written: string[] = [];
  const nextManifest = new Map<string, string>();
  for (const [relPath, content] of files) {
    const abs = join(projectDir, relPath);
    await fs.mkdir(join(abs, ".."), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    written.push(relPath);
    nextManifest.set(relPath, sha256(content));
  }
  await restoreCustomDir(projectDir, customBackup);
  await saveManifest(projectDir, nextManifest);
  return { written: written.sort(), handEdited };
}
