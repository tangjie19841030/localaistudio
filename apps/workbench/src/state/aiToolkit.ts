import { useEditorStore } from "./editorStore";
import { log } from "./logStore";
import type { AiState } from "./aiStore";
import type { ToolkitCommand } from "../features/ai/types";

/**
 * Toolkit (ppt/word) command-plan lifecycle, P7.3.
 *
 * The done frame carries commands the server already pre-executed on a scratch
 * envelope; confirm/accept replays them locally through the registered applier
 * (toolkit executeTransaction) and then auto-saves. The UI rollback/applyOp
 * linkage in aiStore.confirm is UI-document-only and is bypassed here. This
 * module is store-agnostic (AiStoreApi injected by aiStore) to avoid a
 * circular import.
 */

/** Minimal store surface the toolkit lifecycle needs (injected by aiStore). */
export interface AiStoreApi {
  get: () => AiState;
  set: (partial: Partial<AiState>) => void;
}

/** Human-readable failure for a missing applier (editor not mounted/ready). */
const APPLIER_MISSING = "编辑器尚未就绪，无法应用 AI 变更。请重新打开项目后重试。";
/** Whole-plan replay failure (all-or-nothing transaction). */
const APPLY_FAILED =
  "应用变更失败：命令在本地执行未通过（文档可能与生成时不一致），可重试或改用逐条接受。";

/** Shared epilogue: plan consumed + auto-save (rollback versions are UI-only). */
async function settleToolkit(api: AiStoreApi): Promise<void> {
  api.set({ phase: "idle", pendingPlan: null });
  // save() is a no-op unless dirty; its errors surface on editorStore.error.
  await useEditorStore.getState().save();
}

/** Confirm with a command plan: replay every command in one atomic transaction. */
export async function confirmToolkitCommands(
  api: AiStoreApi,
  commands: ToolkitCommand[],
): Promise<void> {
  const applier = api.get().commandApplier;
  if (!applier) {
    api.set({ phase: "error", error: APPLIER_MISSING });
    return;
  }
  const ok = await applier(commands);
  if (!ok) {
    api.set({ phase: "error", error: APPLY_FAILED });
    log("error", "ai", `命令应用失败（${commands.length} 条）`);
    return;
  }
  log("success", "ai", `已应用 ${commands.length} 条命令`);
  await settleToolkit(api);
}

/** Accept one command: apply it, drop it from the plan; settle on the last one. */
export async function acceptToolkitCommand(api: AiStoreApi, command: ToolkitCommand): Promise<void> {
  const plan = api.get().pendingPlan;
  if (!plan?.commands?.some((c) => c.invocationId === command.invocationId)) return;
  const applier = api.get().commandApplier;
  if (!applier) {
    api.set({ phase: "error", error: APPLIER_MISSING });
    return;
  }
  const ok = await applier([command]);
  if (!ok) {
    // The failed item stays in the plan: retry or skip are both still possible.
    api.set({ phase: "error", error: `「${command.title}」应用失败：命令在本地执行未通过，可重试或跳过。` });
    log("error", "ai", `命令应用失败：${command.title}`);
    return;
  }
  log("success", "ai", `已接受：${command.title}`);
  const latest = api.get().pendingPlan;
  if (!latest?.commands) return; // plan dismissed while the applier ran
  const remaining = latest.commands.filter((c) => c.invocationId !== command.invocationId);
  if (remaining.length === 0) {
    await settleToolkit(api);
    return;
  }
  api.set({ pendingPlan: { ...latest, commands: remaining } });
}

/** Skip one command (no local execution); settle when nothing remains. */
export async function skipToolkitCommand(api: AiStoreApi, command: ToolkitCommand): Promise<void> {
  const plan = api.get().pendingPlan;
  if (!plan?.commands?.some((c) => c.invocationId === command.invocationId)) return;
  const remaining = plan.commands.filter((c) => c.invocationId !== command.invocationId);
  if (remaining.length === 0) {
    // Fully processed by accept/skip: earlier accepts may have dirtied the
    // document — settle persists them (save() is a no-op when clean).
    await settleToolkit(api);
    return;
  }
  api.set({ pendingPlan: { ...plan, commands: remaining } });
}
