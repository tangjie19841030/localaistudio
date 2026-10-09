import type { ProjectMeta } from "@studio/schema-core";
import type { EditorDocument } from "../state/editorStore";
import { db } from "./db";
import type { DocumentRecord, DocumentVersion, SessionRecord } from "./db";

export async function putProjectMeta(meta: ProjectMeta): Promise<void> {
  await db.projects.put(meta);
}

/** P7.3: 镜像文档为 per-toolkit 联合（UI 之外暂只透传存储，不做本地编辑）。 */
export async function putDocument(
  projectId: string,
  document: EditorDocument,
  updatedAt: string,
): Promise<void> {
  await db.documents.put({ projectId, document, updatedAt });
}

export async function readDocument(projectId: string): Promise<DocumentRecord | undefined> {
  return db.documents.get(projectId);
}

export async function listLocalProjects(): Promise<ProjectMeta[]> {
  return db.projects.orderBy("updatedAt").reverse().toArray();
}

// ---- 命名版本（P1-10）----

export async function putVersion(version: DocumentVersion): Promise<void> {
  await db.versions.put(version);
}

export async function getVersion(
  projectId: string,
  versionId: string,
): Promise<DocumentVersion | undefined> {
  const v = await db.versions.get(versionId);
  return v?.projectId === projectId ? v : undefined;
}

export async function listVersions(projectId: string): Promise<DocumentVersion[]> {
  const all = await db.versions.where("projectId").equals(projectId).toArray();
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all;
}

export async function deleteVersion(projectId: string, versionId: string): Promise<void> {
  const v = await getVersion(projectId, versionId);
  if (v) await db.versions.delete(versionId);
}

// ---- AI 会话历史（W1-B）----

/** Upsert one session record (sessionId primary key; put overwrites same key). */
export async function saveSession(session: SessionRecord): Promise<void> {
  await db.sessions.put(session);
}

/** Sessions of one project, newest-updated first. */
export async function listSessionsByProject(projectId: string): Promise<SessionRecord[]> {
  const all = await db.sessions.where("projectId").equals(projectId).toArray();
  all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return all;
}

/** Delete only when the session belongs to the project (id-scoped guard). */
export async function deleteSession(projectId: string, sessionId: string): Promise<void> {
  const s = await db.sessions.get(sessionId);
  if (s?.projectId === projectId) await db.sessions.delete(sessionId);
}
