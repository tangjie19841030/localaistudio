import { useEditorStore } from "./editorStore";

interface SaveBeforeExportResult {
  ok: boolean;
  message?: string;
}

/**
 * Persist the current project before an export request. The store's save
 * method reports failures through state, so the state must be checked after
 * awaiting it instead of assuming that a resolved Promise means success.
 */
export async function saveBeforeExport(projectId: string): Promise<SaveBeforeExportResult> {
  const before = useEditorStore.getState();
  if (before.projectId !== projectId) {
    return { ok: false, message: "项目已切换，已阻止导出" };
  }
  if (!before.dirty) return { ok: true };

  await before.save();

  const after = useEditorStore.getState();
  if (after.projectId !== projectId) {
    return { ok: false, message: "项目已切换，已阻止导出" };
  }
  if (after.dirty || after.saving || after.error) {
    return {
      ok: false,
      message: after.error ? `保存失败，已阻止导出：${after.error}` : "保存失败，已阻止导出",
    };
  }
  return { ok: true };
}
