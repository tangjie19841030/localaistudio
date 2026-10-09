import { useState } from "react";
import { visualApi, type VisualRunResult } from "../../api/visual";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore, isUiDoc } from "../../state/editorStore";
import { buildRepairRequest } from "./repairRequest";

/**
 * Fetch only the shots of viewports that actually have issues — a clean shot
 * carries no diagnostic signal and each PNG data URL is a large payload.
 * Falls back to every shot when no issue names a viewport.
 */
async function collectShotDataUrls(projectId: string, run: VisualRunResult): Promise<string[]> {
  const affected = new Set(run.issues.map((i) => i.viewport));
  const shots = run.shots.filter((s) => affected.has(s.viewport));
  const wanted = shots.length > 0 ? shots : run.shots;
  return await Promise.all(
    wanted.map((s) => visualApi.fetchShotDataUrl(projectId, run.runId, s.file)),
  );
}

/**
 * Assemble and dispatch the multimodal repair turn. Goes through the existing
 * aiStore.send patch path, so the user still confirms via the change-plan card;
 * nothing is applied here.
 */
async function dispatchRepair(projectId: string, run: VisualRunResult): Promise<void> {
  const shotDataUrls = await collectShotDataUrls(projectId, run);
  const request = buildRepairRequest({ issues: run.issues, shotDataUrls });
  // Scope must include the document root: insert_node audits the TARGET PARENT,
  // and repair often nests fixes under root. Without it the loop rejects every
  // insert as "节点 root 超出修改范围" (real-model flow finding).
  const doc = useEditorStore.getState().document;
  const rootId = isUiDoc(doc) ? doc.pages[0]!.rootId : undefined; // P7.3: 修复管线仅 UI 文档有 root
  const nodeIds = rootId && !request.nodeIds.includes(rootId)
    ? [...request.nodeIds, rootId]
    : request.nodeIds;
  await useAiStore.getState().send({
    projectId,
    text: request.text,
    mode: "patch",
    scope: { nodeIds, allowAllTokens: false },
    images: request.images,
  });
}

export interface VisualRepair {
  /** True while shots are being read and the request is in flight (busy label). */
  repairing: boolean;
  /** Assembly/send failure, surfaced through the panel's role="alert". */
  repairError: string | null;
  repair(projectId: string | null, run: VisualRunResult | null): Promise<void>;
}

/** Local repair state for VisualPanel; kept out of the component to stay under the size limit. */
export function useVisualRepair(): VisualRepair {
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);

  const repair = async (projectId: string | null, run: VisualRunResult | null): Promise<void> => {
    if (!projectId || !run || run.issues.length === 0) return;
    setRepairing(true);
    setRepairError(null);
    try {
      await dispatchRepair(projectId, run);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  return { repairing, repairError, repair };
}
