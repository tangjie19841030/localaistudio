import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DocumentEnvelope } from "@studio/studio-core";
import {
  checkStudioDocument,
  validateDocument,
  type StudioDocument,
} from "@studio/schema-core";
import {
  DocumentInvalidError,
  NotFoundError,
  PathError,
  type ProjectsStore,
} from "./projects.js";
import { versionsDir } from "../toolkits/project-format.js";

export interface VersionSummary {
  versionId: string;
  name: string;
  createdAt: string;
  projectId: string;
}

/**
 * On-disk version record: summary fields + the frozen document snapshot.
 * V2 projects additionally persist the envelope (P7.2); `document` stays
 * in both shapes so cross-session diff readers keep working.
 */
export interface VersionRecord extends VersionSummary {
  document: StudioDocument;
  envelope?: DocumentEnvelope;
}

export interface VersionsStore {
  create(projectId: string, name: string, document: StudioDocument): Promise<VersionSummary>;
  list(projectId: string): Promise<VersionSummary[]>;
  /** Full record including the frozen document — powers cross-session version comparison. */
  read(projectId: string, versionId: string): Promise<VersionRecord>;
  remove(projectId: string, versionId: string): Promise<void>;
}

const VERSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-project version retention cap (P1). 50 matches the workbench undo stack
 * depth — versions older than what the UI can still step back to are dead
 * weight anyway. Enforced right after a successful create: oldest overflow
 * files are deleted; a delete failure only warns (retention must never turn a
 * successful create into a 500) and the just-created version is never a
 * deletion candidate.
 */
export const MAX_VERSIONS_PER_PROJECT = 50;

/** Version ids are used as file names — reject anything non-UUID (path traversal guard). */
function assertSafeVersionId(versionId: string): string {
  if (!VERSION_ID_RE.test(versionId)) {
    throw new PathError(`非法版本 ID: "${versionId}"`);
  }
  return versionId;
}

/**
 * Version storage layered on top of the projects dir. Path selection is
 * per-project format (P7.2):
 * - V2:  `<baseDir>/<projectId>/document/versions/<versionId>.json`（记录含 envelope）
 * - legacy: `<baseDir>/<projectId>/design/versions/<versionId>.json`（行为不变）
 * Project existence is verified through the projects store before any version I/O.
 */
export function createVersionsStore(
  baseDir: string,
  projects: Pick<ProjectsStore, "exists" | "formatInfo" | "currentEnvelope">,
): VersionsStore {
  /** 版本目录：V2 → document/versions（project-format 提供）；legacy → design/versions。 */
  const dirFor = async (projectId: string): Promise<string> =>
    (await projects.formatInfo(projectId)).source === "v2"
      ? versionsDir(join(baseDir, projectId))
      : join(baseDir, projectId, "design", "versions");

  const filePath = (dir: string, versionId: string) => join(dir, `${assertSafeVersionId(versionId)}.json`);

  async function readVersionFile(dir: string, versionId: string): Promise<VersionRecord> {
    const raw = await fs.readFile(filePath(dir, versionId), "utf8");
    const record = JSON.parse(raw) as VersionRecord;
    record.document = validateDocument(record.document); // tolerate schema drift loudly
    return record;
  }

  async function create(projectId: string, name: string, document: StudioDocument): Promise<VersionSummary> {
    await projects.exists(projectId); // PathError→400 / NotFound→404
    const dir = await dirFor(projectId);
    const { source } = await projects.formatInfo(projectId);
    const currentEnvelope = source === "v2" ? await projects.currentEnvelope(projectId) : null;
    const doc = validateDocument(document);
    const issues = checkStudioDocument(doc);
    if (issues.length > 0) {
      throw new DocumentInvalidError(issues);
    }
    // V2 版本快照冻结当前信封头部（toolkitId/版本号随项目权威值），document 为冻结文档。
    const record: VersionRecord = {
      versionId: randomUUID(),
      projectId,
      name,
      createdAt: new Date().toISOString(),
      document: doc,
      ...(currentEnvelope ? { envelope: { ...currentEnvelope, document: doc } } : {}),
    };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath(dir, record.versionId), JSON.stringify(record, null, 2), "utf8");
    await pruneOverflow(dir, record.versionId);
    const { versionId, name: n, createdAt, projectId: pid } = record;
    return { versionId, name: n, createdAt, projectId: pid };
  }

  async function list(projectId: string): Promise<VersionSummary[]> {
    await projects.exists(projectId);
    const dir = await dirFor(projectId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const summaries: VersionSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const record = await readVersionFile(dir, entry.slice(0, -5));
        const { versionId, name, createdAt, projectId: pid } = record;
        summaries.push({ versionId, name, createdAt, projectId: pid });
      } catch (err) {
        // Skip unreadable files so the list stays usable, but keep a visible trace.
        console.error(`[server] 跳过无法读取的版本文件: ${entry}（${(err as Error).message}）`);
      }
    }
    summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return summaries;
  }

  async function read(projectId: string, versionId: string): Promise<VersionRecord> {
    await projects.exists(projectId);
    assertSafeVersionId(versionId); // traversal guard before touching the FS
    const dir = await dirFor(projectId);
    try {
      return await readVersionFile(dir, versionId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(`版本不存在: ${versionId}`);
      }
      throw err;
    }
  }

  async function remove(projectId: string, versionId: string): Promise<void> {
    await projects.exists(projectId);
    assertSafeVersionId(versionId); // traversal guard before touching the FS
    const dir = await dirFor(projectId);
    try {
      await fs.rm(filePath(dir, versionId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(`版本不存在: ${versionId}`);
      }
      throw err;
    }
  }

  return { create, list, read, remove };
}

/**
 * Delete the oldest versions beyond MAX_VERSIONS_PER_PROJECT for one project.
 * Best-effort: a failed delete only logs a warning — retention must never
 * fail a create that already succeeded. `keepVersionId` (the just-created
 * version) is exempt from deletion even if sorting says otherwise.
 */
async function pruneOverflow(versionsDir: string, keepVersionId: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(versionsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const records: { versionId: string; createdAt: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(join(versionsDir, entry), "utf8");
      const record = JSON.parse(raw) as VersionRecord;
      records.push({ versionId: record.versionId, createdAt: record.createdAt });
    } catch (err) {
      console.error(`[server] 保留清理跳过无法读取的版本文件: ${entry}（${(err as Error).message}）`);
    }
  }
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first
  const overflow = records.slice(0, Math.max(0, records.length - MAX_VERSIONS_PER_PROJECT));
  for (const { versionId } of overflow) {
    if (versionId === keepVersionId) continue; // never delete the active version
    try {
      await fs.rm(join(versionsDir, `${versionId}.json`));
    } catch (err) {
      console.error(`[server] 清理超限版本失败（已忽略）: ${versionId}（${(err as Error).message}）`);
    }
  }
}
