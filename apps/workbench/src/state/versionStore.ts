import type { StudioDocument } from "@studio/schema-core";
import { api, type RemoteVersion } from "../api/client";
import {
  deleteVersion as dbDeleteVersion,
  getVersion,
  listVersions as dbListVersions,
  putVersion,
} from "../db/repo";

/**
 * Version list item consumed by VersionPanel.
 * document is the frozen snapshot needed for restore; it comes from the Dexie
 * mirror (the server list endpoint returns summaries only). null means the
 * local mirror is gone (e.g. cleared IndexedDB) and restore is unavailable.
 */
export interface VersionListItem {
  versionId: string;
  projectId: string;
  name: string;
  createdAt: string;
  document: StudioDocument | null;
}

/**
 * Named-version orchestration (P1-10): dual-write to server + Dexie mirror.
 * Server is the source of truth; Dexie keeps versions restorable offline.
 */

/** Save current document as a named version. Server first; errors propagate. */
export async function saveVersion(
  projectId: string,
  name: string,
  document: StudioDocument,
): Promise<VersionListItem> {
  const created: RemoteVersion = await api.createVersion(projectId, { name, document });
  const item: VersionListItem = { ...created, document };
  try {
    await putVersion({ ...created, document }); // non-null here; Dexie record is a full snapshot
  } catch (err) {
    // Mirror failure must not fail the save (server copy is already durable).
    console.error("[versionStore] Dexie 镜像写入失败:", err);
  }
  return item;
}

/** List versions; prefer the server, fall back to the Dexie mirror when offline. */
export async function loadVersions(projectId: string): Promise<VersionListItem[]> {
  try {
    const remote = await api.listVersions(projectId);
    // Hydrate documents from the local mirror so restore works across sessions.
    return Promise.all(
      remote.map(async (r) => {
        const local = await getVersion(projectId, r.versionId);
        return { ...r, document: local?.document ?? null };
      }),
    );
  } catch {
    return dbListVersions(projectId);
  }
}

/** Delete a version on both server and local mirror. Server errors propagate. */
export async function removeVersion(projectId: string, versionId: string): Promise<void> {
  await api.deleteVersion(projectId, versionId);
  await dbDeleteVersion(projectId, versionId);
}
