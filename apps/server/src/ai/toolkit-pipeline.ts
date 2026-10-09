import type { ToolKit } from "@studio/studio-core";
import { parseSelectionScope, type DocumentEnvelope, type SelectionScope } from "@studio/studio-core";
import type { ProjectsStore } from "../store/projects.js";
import { readSettings } from "../store/settings.js";
import { createBuiltinToolKitRegistry } from "../toolkits/builtin-registry.js";
import { listProjectAssets, type ProjectAssetInfo } from "../toolkits/ppt/assets.js";
import type { ChatMessage } from "./provider.js";
import type { SendEvent } from "./routes.js";
import { createMockToolkitDriver, type ToolkitDriver } from "./mock-toolkit.js";
import { createScopeHealer, SCOPE_VANISHED_MESSAGE, type ScopeHealer } from "./scope-heal.js";
import { runBatch } from "./toolkit-batch.js";
import { buildToolkitSdkDriver } from "./toolkit-sdk-driver.js";
import { allowedCommandIds, commandMeta } from "./toolkit-scope.js";
import {
  applyBatch,
  endOfRound,
  MAX_STEPS,
  sendTerminal,
  type LoopState,
  type ToolkitCommandPlanItem,
  type ToolkitLoopResult,
} from "./toolkit-loop-helpers.js";

// Thin re-exports keep the pre-split import paths valid (routes.ts / tests).
export { imageGuideLines, wordImageGuideLines } from "./toolkit-prompt.js";
export type { ToolkitCall } from "./mock-toolkit.js";
export { humanizeScopeError, type ToolkitCommandPlanItem } from "./toolkit-loop-helpers.js";

/**
 * Toolkit AI pipeline (P7.3): chat for ppt/word projects. The AI proposes
 * CommandInvocations (constrained by the toolkit's aiTools for the active
 * scope), PRE-EXECUTED on a scratch envelope — the stored project is never
 * mutated here; the done frame carries the executed command list and the
 * workbench re-applies it locally on confirm. ORCHESTRATION only: scope
 * admission lives in toolkit-scope.ts, batch pre-execution in toolkit-batch.ts,
 * prompt building in toolkit-prompt.ts, the driver in toolkit-sdk-driver.ts,
 * and the loop/terminal helpers in toolkit-loop-helpers.ts.
 */

export interface ToolkitChatDeps {
  store: ProjectsStore;
  /** Test seam for exercising the scoped loop without selecting a provider. */
  toolkitDriver?: ToolkitDriver;
}

const registry = createBuiltinToolKitRegistry();

/** Everything the entry needs after loading project/scoped context. */
interface ChatContext {
  toolkit: ToolKit;
  envelope: DocumentEnvelope;
  scope: SelectionScope;
  healer: ScopeHealer;
  assets: ProjectAssetInfo[];
  outbound: ChatMessage[];
  settings: Awaited<ReturnType<typeof readSettings>>;
}

/** Request body of the toolkit chat endpoint. */
interface ToolkitChatBody {
  projectId: string;
  messages: ChatMessage[];
  scope?: { nodeIds?: string[]; allowAllTokens?: boolean; kind?: string; targetIds?: string[] };
}

/** Loop body shared by mock and SDK drivers (P6-2 shape: batch → adopt → repeat). */
async function runToolkitLoop(
  toolkit: ToolKit,
  driver: ToolkitDriver,
  envelope: DocumentEnvelope,
  scope: SelectionScope,
  messages: ChatMessage[],
  signal: AbortSignal | undefined,
  send: SendEvent,
  healer?: ScopeHealer,
): Promise<ToolkitLoopResult> {
  const allowed = allowedCommandIds(toolkit, scope);
  const executed: ToolkitCommandPlanItem[] = [];
  const meta = commandMeta(toolkit);
  const st: LoopState = { current: envelope, effectiveScope: scope, stepCount: 0, consecutiveFailures: 0, lastFailureMessage: "" };
  while (st.stepCount < MAX_STEPS) {
    if (signal?.aborted) return { ok: false, envelope: st.current, commands: executed, scope: st.effectiveScope };
    let activeScope = st.effectiveScope;
    if (healer) {
      const healed = healer.heal(st.current);
      if (!healed) {
        return { ok: false, envelope: st.current, commands: executed, error: SCOPE_VANISHED_MESSAGE, scope: st.effectiveScope };
      }
      activeScope = healed;
      st.effectiveScope = healed;
    }
    // Announce BEFORE the model round-trip: driver.next is the long-silent
    // window (10-60s with a real model) this frame exists for.
    void send({ type: "stage", id: "model", label: "模型思考中…" });
    const calls = await driver.next({ messages, scope: activeScope, envelope: st.current, signal });
    if (calls.length === 0) return endOfRound(driver, executed, meta, st);
    const batch = runBatch(toolkit, calls, st.current, activeScope, allowed, send, healer);
    if (batch.scope) st.effectiveScope = batch.scope;
    if (batch.fatal) {
      return { ok: false, envelope: batch.envelope, commands: executed, error: batch.fatal, scope: st.effectiveScope };
    }
    st.current = batch.envelope;
    st.stepCount += batch.steps.length;
    const stop = applyBatch(batch, executed, meta, st, send, scope);
    if (stop) return stop;
  }
  // Budget exhausted: whatever executed so far is still valid work — hand it
  // to the client as the final (confirmable) batch rather than discarding it.
  return { ok: true, envelope: st.current, commands: executed, error: `步数预算（${MAX_STEPS}）耗尽，已完成部分仍可保留`, finalDoneSent: true, scope: st.effectiveScope };
}

/** Load project/toolkit/scoped context for one chat turn; null = error frame already sent. */
async function loadChatContext(
  deps: ToolkitChatDeps & { dataDir: string },
  body: ToolkitChatBody,
  send: SendEvent,
): Promise<ChatContext | null> {
  const projectType = await deps.store.readMetaProjectType(body.projectId);
  const toolkit = registry.getForProjectType(projectType);
  const rawEnvelope = await deps.store.currentEnvelope(body.projectId);
  if (!rawEnvelope) {
    await send({ error: "invalid_project", message: "项目不是 V2 格式，无法使用工具包 AI（旧项目请先迁移）" });
    return null;
  }
  // The on-disk envelope.documentVersion is the SAVE REVISION; ppt/word
  // adapters pin it to the domain schema version. Re-stamp from the domain
  // document (same semantics as the store's envelopeView) or every post-save
  // chat turn fails the adapter's identity assert.
  const domainVersion = (rawEnvelope.document as { documentVersion?: number } | null)?.documentVersion ?? 1;
  const envelope: DocumentEnvelope = { ...rawEnvelope, documentVersion: domainVersion };
  if (body.scope?.kind !== "file" && body.scope?.kind !== "container" && body.scope?.kind !== "selection") {
    await send({ error: "invalid_scope", message: "缺少有效的选择范围（file/container/selection）" });
    return null;
  }
  const scope: SelectionScope = parseSelectionScope({ kind: body.scope.kind, targetIds: body.scope.targetIds ?? [] });
  // Heal a scope whose target the run itself deletes (selected placeholder →
  // object.remove → object.add replacement); without this every later command
  // dies in resolveScope and the model retries until its budget is gone.
  const healer = createScopeHealer(projectType === "word" ? "word" : "ppt", envelope, scope);
  // Project image assets are the ONLY image srcs the model may use (no web
  // access); scanned once per request and shown in every round's prompt.
  const assets =
    projectType === "ppt" || projectType === "word"
      ? await listProjectAssets(deps.store, body.projectId)
      : [];
  const settings = await readSettings(deps.dataDir);
  const outbound: ChatMessage[] = body.messages.map((m) => ({ role: m.role, content: m.content }));
  return { toolkit, envelope, scope, healer, assets, outbound, settings };
}

/** Pick the driver: test seam → mock → openai-compat; null = provider_unavailable already sent. */
async function pickToolkitDriver(ctx: ChatContext, deps: ToolkitChatDeps, send: SendEvent): Promise<ToolkitDriver | null> {
  if (deps.toolkitDriver) {
    return deps.toolkitDriver;
  }
  if (ctx.settings.provider === "mock") {
    return createMockToolkitDriver(ctx.toolkit, ctx.scope, ctx.outbound, ctx.envelope.document);
  }
  if (ctx.settings.provider === "openai-compat") {
    const { createStudioModel } = await import("./modelProvider.js");
    const studio = createStudioModel(ctx.settings);
    if (!studio?.sdk || !studio.model) {
      await send({ error: "provider_unavailable", message: "openai-compat 配置不完整，无法调用模型" });
      return null;
    }
    return buildToolkitSdkDriver(studio.model, ctx.toolkit, ctx.scope, send, ctx.healer, ctx.assets);
  }
  await send({ error: "provider_unavailable", message: "该提供商暂不支持工具包项目" });
  return null;
}

/** Entry: chat for ppt/word projects. Reads settings, picks the driver, streams. */
export async function runToolkitChatStream(
  deps: ToolkitChatDeps & { dataDir: string },
  body: {
    projectId: string;
    messages: ChatMessage[];
    scope?: { nodeIds?: string[]; allowAllTokens?: boolean; kind?: string; targetIds?: string[] };
  },
  controller: AbortController,
  send: SendEvent,
): Promise<void> {
  const ctx = await loadChatContext(deps, body, send);
  if (!ctx) return;
  // Tee the outbound stream to capture the model's streamed explanation
  // (drivers forward step text as { delta }): an empty-command terminal frame
  // carries this text instead of the fixed "无需修改" notice (T30 §4.6).
  // The tee must wrap the stream BEFORE the driver is built — the SDK driver
  // captures send at construction and emits its step-text deltas through it,
  // so a tee installed only around runToolkitLoop would miss every delta.
  let modelDelta = "";
  const teeSend: SendEvent = async (event) => {
    if (typeof (event as { delta?: unknown }).delta === "string") {
      modelDelta += (event as { delta: string }).delta;
    }
    await send(event);
  };
  const driver = await pickToolkitDriver(ctx, deps, teeSend);
  if (!driver) return;
  void send({ type: "stage", id: "reading", label: "正在读取项目…" });
  const result = await runToolkitLoop(ctx.toolkit, driver, ctx.envelope, ctx.scope, ctx.outbound, controller.signal, teeSend, ctx.healer);
  if (controller.signal.aborted) {
    await send({ canceled: true });
    return;
  }
  await sendTerminal(send, ctx.scope, result, modelDelta);
}
