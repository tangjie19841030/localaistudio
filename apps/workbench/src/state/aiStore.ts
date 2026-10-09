import {
  applyPatch,
  collectSubtreeIds,
  OpError,
  type StudioDocument,
} from "@studio/schema-core";
import { create } from "zustand";
import { cancelChat, streamChat, type ChatEvent, type StreamChatBody } from "../api/client";
import { buildScope, modeFor, type ModeDecision } from "../features/ai/intent";
import {
  attachImages,
  finalizeDone,
  formatStreamError,
  outboundChatMessages,
  readableDoneText,
  parseToolkitCommands,
} from "../features/ai/payload";
import {
  toAwaitingConfirm,
  toError,
  toNotice,
  visibilityPatch,
  withReset,
  type ProgressState,
  type StageState,
} from "../features/ai/events";
import {
  isToolkitScope,
  type AiPhase,
  type ChatLogMessage,
  type PendingPlan,
  type SendRequest,
  type ToolkitCommand,
  type ToolkitCommandApplier,
  type ToolTraceStep,
} from "../features/ai/types";
import {
  activityAppendThought,
  activityOnBatch,
  activityOnProgress,
  activityOnStage,
  activityOnToolCall,
  activityOnToolResult,
  activityOnVerifyRound,
  activityOnViolation,
  activityDoneOpCount,
  finishActivity,
  startActivity,
  type ActivityState,
  type ActivityStatus,
} from "../features/ai/activity";
import type { CommandDomain } from "../features/ai/commandLabels";
import {
  acceptToolkitCommand,
  confirmToolkitCommands,
  skipToolkitCommand,
  type AiStoreApi,
} from "./aiToolkit";
import { useEditorStore, isUiDoc } from "./editorStore";
import { log } from "./logStore";
import { saveVersion } from "./versionStore";

/** Tell the server to abort a turn without throwing when the call fails. */
function bestEffortCancel(requestId: string): void {
  Promise.resolve()
    .then(() => cancelChat(requestId))
    .catch(() => {});
}

// Chat log / plan / phase / request types live in features/ai/types.ts —
// shared with the toolkit contract (P7.3); only store behavior remains here.

export interface AiState {
  messages: ChatLogMessage[];
  phase: AiPhase;
  error: string | null;
  /** Neutral outcome notice (e.g. empty ops) — not a service failure. */
  notice: string | null;
  requestId: string | null;
  pendingPlan: PendingPlan | null;
  violations: string[] | null;
  /** Pre-application rollback snapshot; confirm stores it as an "AI 回退点" version. */
  rollbackDoc: StudioDocument | null;
  /** T61 W3-B: active candidate tab of the pending generate plan (0 = plan.document). */
  selectedAlternative: number;
  /** Tool steps of the in-flight agent turn; moves into pendingPlan.toolTrace on done (P6). */
  toolTrace: ToolTraceStep[];
  /** Live activity timeline of the in-flight turn; archived into messages on done. */
  activity: ActivityState | null;
  /** Human-readable in-flight stage ("reading/model/verify/writing"); null when idle. */
  stage: StageState | null;
  /** Step counter for the current stage (server "progress" frames); null when idle. */
  progress: ProgressState | null;
  /** Timestamp of the last SSE frame (any kind); drives the stall warning. */
  lastFrameAt: number | null;
  /** Aborts the in-flight streamChat fetch on cancel(); null while idle. */
  abortController: AbortController | null;
  /** Registered local replay applier for toolkit command plans (ppt/word via App). */
  commandApplier: ToolkitCommandApplier | null;
  /** Unsent AI composer values keyed by project so remounts and project switches are recoverable. */
  composerDrafts: Record<string, { text: string; images: string[]; variants?: 0 | 2 | 3 }>;
  send(req: SendRequest): Promise<void>;
  confirm(projectId: string): Promise<void>;
  /** Toolkit plans: replay one pre-executed command locally, then drop it (P7.3). */
  acceptCommand(projectId: string, command: ToolkitCommand): Promise<void>;
  /** Toolkit plans: drop one command without executing it (P7.3). */
  skipCommand(command: ToolkitCommand): Promise<void>;
  cancel(): Promise<void>;
  clear(): void;
  setComposerDraft(projectId: string, draft: { text: string; images: string[]; variants?: 0 | 2 | 3 }): void;
  clearComposerDraft(projectId: string): void;
  /** Register/unregister the local replay applier for toolkit command plans. */
  setCommandApplier(fn: ToolkitCommandApplier | null): void;
  /**
   * modeFor(selection, text, doc): selection (single id or multi-select array)
   * drives patch-local vs generate-whole-page; `doc` lets a blank document
   * force generate (nothing to patch yet).
   */
  modeFor(selection: string | string[] | null, text: string, doc?: StudioDocument | null): ModeDecision;
  buildScope(
    doc: StudioDocument | null,
    selection: string | string[] | null,
    extraNodeIds?: string[],
    allowAllTokens?: boolean,
  ): { nodeIds: string[]; allowAllTokens: boolean } | undefined;
}

let msgSeq = 0;
const nextMsgId = (): string => {
  msgSeq += 1;
  return `msg-${msgSeq}-${Date.now()}`;
};

/** Terminal-state reducers now live in features/ai/events.ts (withReset wired in). */
export { outboundChatMessages };

export const useAiStore = create<AiState>()((set, get) => {
  // Injected into the toolkit lifecycle helpers (avoids a circular import).
  const api: AiStoreApi = { get, set };
  return {
  messages: [],
  phase: "idle",
  error: null,
  notice: null,
  requestId: null,
  pendingPlan: null,
  violations: null,
  rollbackDoc: null,
  selectedAlternative: 0,
  toolTrace: [],
  activity: null,
  stage: null,
  progress: null,
  lastFrameAt: null,
  abortController: null,
  commandApplier: null,
  composerDrafts: {},

  async send(req) {
    // Toolkit turns render their progress as the activity timeline card
    // (no empty assistant bubble — the card IS the assistant turn).
    const toolkitTurn = isToolkitScope(req.scope);
    // T61 OP-3: draft read must precede the first await — Composer clears the
    // draft right after onSend returns. variants rides generate turns only.
    const draft = get().composerDrafts[req.projectId];
    const domain: CommandDomain = req.toolkit ?? "ui";
    const userMsg: ChatLogMessage = { id: nextMsgId(), role: "user", text: req.text, streaming: false };
    const assistantMsg: ChatLogMessage = { id: nextMsgId(), role: "assistant", text: "", streaming: true };
    const requestId = crypto.randomUUID();
    set((s) => ({
      messages: toolkitTurn ? [...s.messages, userMsg] : [...s.messages, userMsg, assistantMsg],
      phase: "streaming",
      error: null,
      notice: null,
      requestId,
      selectedAlternative: 0,
      toolTrace: [],
      activity: startActivity(`activity-${requestId}`, Date.now()),
      // 流式可见性：阶段行从空起步；lastFrameAt 以请求发出为起点（停滞检测计时）
      stage: null,
      progress: null,
      lastFrameAt: Date.now(),
    }));
    log(
      "info",
      "ai",
      `发送 ${req.mode === "patch" ? "局部修改" : "整页生成"}${req.images?.length ? `（含 ${req.images.length} 张参考图）` : ""}`,
    );
    const appendDelta = (text: string): void => {
      if (get().requestId !== requestId) return; // stale stream after clear/new send
      // Toolkit turns: model step text feeds the timeline's thought steps
      // instead of an (empty/JSON-cluttered) assistant bubble.
      if (toolkitTurn) {
        set((s) => ({
          activity: s.activity ? activityAppendThought(s.activity, text, Date.now()) : null,
        }));
        return;
      }
      set((s) => ({
        messages: s.messages.map((m, i) =>
          i === s.messages.length - 1 ? { ...m, text: m.text + text } : m,
        ),
      }));
    };
    const finishStreaming = (): void => {
      // Close EVERY streaming bubble: once the activity card is archived it is
      // the last message, so a last-index-only update would leave the assistant
      // placeholder blinking forever.
      set((s) => ({
        messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
      }));
    };
    /**
     * Terminal handoff for the live activity: converge its steps (finishActivity),
     * clear the in-flight `activity` and append it as an archived timeline
     * message. No-op if the turn never started one. `title` may derive from the
     * finished state (it needs the stamped endedAt for the elapsed suffix).
     */
    const archiveActivity = (
      status: Exclude<ActivityStatus, "live">,
      opts?: { title?: (finished: ActivityState) => string; errorMessage?: string },
    ): void => {
      const current = get().activity;
      if (!current) return;
      const now = Date.now();
      const settled = finishActivity(current, status, now, { errorMessage: opts?.errorMessage });
      const finished = opts?.title ? { ...settled, resultTitle: opts.title(settled) } : settled;
      const card: ChatLogMessage = {
        id: nextMsgId(),
        role: "assistant",
        text: "",
        streaming: false,
        kind: "activity",
        activity: finished,
      };
      set({ activity: null, messages: [...get().messages, card] });
    };
    /** Prefix + elapsed seconds, e.g. "已全部应用 · 3 个操作 · 耗时 12s". */
    const timedTitle = (prefix: string) => (f: ActivityState): string =>
      `${prefix} · 耗时 ${Math.max(1, Math.round(((f.endedAt ?? Date.now()) - f.startedAt) / 1000))}s`;
    /** invocationIds already auto-applied via partial batches (dedupe final). */
    const appliedIds = new Set<string>();
    let partialApplyFailed = false;
    let locallyAborted = false;
    let sawTurnEnd = false;
    let eventQueue = Promise.resolve();
    const failPartialApply = (message: string): void => {
      partialApplyFailed = true;
      locallyAborted = true;
      sawTurnEnd = true;
      // Stop the still-running server turn: later batches would otherwise keep
      // mutating the document behind an already-failed card.
      get().abortController?.abort();
      bestEffortCancel(requestId);
      // A failed batch must remain visibly failed even when the server sends its
      // final done frame immediately afterwards.
      set(toError(message));
      archiveActivity("error", { errorMessage: message });
      finishStreaming();
      log("error", "ai", message);
    };
    const handleEvent = async (ev: ChatEvent): Promise<void> => {
      // Turn/project isolation: after clear() (back to project list) or a new
      // send, stale frames from an older stream must never touch the current
      // project — they used to replay into a freshly opened deck and even
      // auto-save under the new project id.
      if (get().requestId !== requestId) return;
      if ("delta" in ev) return;
      if ("violation" in ev) {
        set({ violations: ev.violation }); // keep streaming; server retries once (spec §8.3)
        set((s) => ({
          activity: s.activity ? activityOnViolation(s.activity, ev.violation, Date.now()) : null,
        }));
        log("warn", "ai", "范围拦截：超出允许范围，已自动重试");
        return;
      }
      if ("type" in ev) {
        const visible = visibilityPatch(ev);
        if (visible) {
          set(visible); // stage/progress/heartbeat/verify-round → 停滞时钟（stage state 保留）
          // Feed the same visibility frames into the live activity timeline.
          if (ev.type === "stage") {
            set((s) => ({
              activity: s.activity ? activityOnStage(s.activity, ev, Date.now()) : null,
            }));
          } else if (ev.type === "verify-round") {
            set((s) => ({
              activity: s.activity
                ? activityOnVerifyRound(s.activity, ev, "文档校验未通过，自动修复中", Date.now())
                : null,
            }));
          } else if (ev.type === "progress") {
            set((s) => ({
              activity: s.activity ? activityOnProgress(s.activity, ev) : null,
            }));
          }
          return;
        }
        if (ev.type === "tool-call") {
          set((s) => ({
            activity: s.activity ? activityOnToolCall(s.activity, ev.name, domain, Date.now()) : null,
          }));
        } else if (ev.type === "tool-result") {
          set((s) => ({
            toolTrace: [...s.toolTrace, { name: ev.name, ok: ev.ok, message: ev.message }],
            activity: s.activity
              ? activityOnToolResult(s.activity, ev.name, ev.ok, ev.message, Date.now())
              : null,
          }));
        }
        return;
      }
      if ("canceled" in ev) {
        sawTurnEnd = true;
        set(withReset({ phase: "idle", requestId: null }));
        archiveActivity("canceled");
        finishStreaming();
        log("info", "ai", "生成已取消");
        return;
      }
      if ("error" in ev) {
        sawTurnEnd = true;
        const message = formatStreamError(ev);
        set(toError(message));
        archiveActivity("error", { errorMessage: message });
        finishStreaming();
        log("error", "ai", `生成失败：${message}`);
        return;
      }
      // Progressive batch (partial:true): auto-apply immediately via the
      // registered applier so the user watches results land batch by batch.
      // Streaming continues — more batches may follow. The pending plan does
      // NOT exist yet (only the final done frame creates it), so the request
      // scope is passed explicitly — the applier falls back to it.
      if (ev.done === true && (ev as { partial?: boolean }).partial === true) {
        // A previous batch already failed: never mutate the document again.
        if (partialApplyFailed) return;
        const cmds = parseToolkitCommands((ev as { commands?: unknown }).commands) ?? [];
        const pending = cmds.filter((c) => !appliedIds.has(c.invocationId));
        if (pending.length === 0) return;
        const applier = get().commandApplier;
        if (!applier) {
          failPartialApply("分批应用失败：编辑器尚未就绪，无法应用 AI 变更。请重新打开项目后重试。");
          return;
        }
        try {
          // The frame can carry a HEALED scope (the run deleted its own
          // selected target → widened to its container); replay must use it
          // or the local transaction fails on the now-vanished target.
          const frameScope = (ev as { scope?: unknown }).scope;
          const replayScope = isToolkitScope(frameScope)
            ? frameScope
            : isToolkitScope(req.scope)
              ? req.scope
              : undefined;
          const ok = await applier(pending, replayScope);
          if (!ok) {
            failPartialApply("分批应用失败：命令与当前文档冲突");
            return;
          }
          // Register only after the local transaction has actually succeeded;
          // this keeps a failed invocation eligible for a later retry and for
          // the final-frame plan.
          pending.forEach((c) => appliedIds.add(c.invocationId));
          // Timeline: record the auto-applied batch (its command titles are
          // human-readable — no label lookup needed).
          set((s) => ({
            activity: s.activity ? activityOnBatch(s.activity, pending, Date.now()) : null,
          }));
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          failPartialApply(`分批应用失败：${reason || "命令在本地执行未通过"}`);
        }
        return;
      }
      // A failed partial batch owns the terminal state. The final frame may
      // contain the same commands, but it must not turn that failure into a
      // successful all-applied notice.
      if (partialApplyFailed) return;
      // done: branch by request mode (payload contract differs, spec §5.2);
      // the turn's tool trace moves into the confirm card's plan (P6).
      // Toolkit final frame: drop commands already auto-applied via partial
      // batches (invocationId dedupe) so nothing replays twice. When dedupe
      // empties the list but partial batches DID apply work, show a completed
      // notice — the generic empty-commands notice ("无需修改") would be false.
      sawTurnEnd = true; // final (non-partial) done frame
      let evFinal = ev;
      let allAutoApplied = false;
      if (Array.isArray((ev as { commands?: unknown }).commands)) {
        const original = (ev as { commands?: unknown[] }).commands as { invocationId: string }[];
        const remaining = original.filter((c) => !appliedIds.has(c.invocationId));
        if (remaining.length === 0 && original.length > 0 && appliedIds.size > 0) {
          allAutoApplied = true;
        }
        evFinal = { ...ev, commands: remaining } as typeof ev;
      }
      const patch = finalizeDone(
        evFinal,
        req.mode,
        get().toolTrace,
        get().violations,
        toAwaitingConfirm,
        toError,
        (message) => (allAutoApplied ? toNotice("已全部应用（分批执行完成）。") : toNotice(message)),
      );
      // P7.3: attach the scope to toolkit command plans so local replay reuses
      // the exact scope the server pre-executed under — prefer the frame's
      // healed scope (selection target deleted mid-run → container widening).
      const plan = patch.pendingPlan as PendingPlan | undefined;
      const frameScope = (evFinal as { scope?: unknown }).scope;
      const planScope = isToolkitScope(frameScope)
        ? frameScope
        : isToolkitScope(req.scope)
          ? req.scope
          : undefined;
      if (plan?.commands && planScope) plan.scope = planScope;
      // The chat bubble accumulated the raw done text ({plan,ops} JSON) via
      // deltas — replace it with the readable plan line (user-facing).
      const readable = readableDoneText(ev);
      set((s) => ({
        ...patch,
        requestId: null,
        toolTrace: [],
        messages: s.messages.map((m) =>
          m.role === "assistant" && m.streaming && m.kind !== "activity"
            ? { ...m, text: readable, streaming: false }
            : m,
        ),
      }));
      finishStreaming();
      // Archive the live activity timeline into the message list.
      const terminalPhase = patch.phase as AiPhase | undefined;
      if (terminalPhase === "error") {
        archiveActivity("error", {
          errorMessage: (patch.error as string | undefined) ?? "生成失败",
        });
      } else if (terminalPhase === "awaiting-confirm") {
        const prefix = planTitlePrefix(patch.pendingPlan as PendingPlan | undefined);
        archiveActivity("done", { title: timedTitle(prefix) });
      } else if (allAutoApplied) {
        archiveActivity("done", {
          title: (f) => timedTitle(`已全部应用 · ${activityDoneOpCount(f)} 个操作`)(f),
        });
      } else {
        const notice = typeof patch.notice === "string" ? patch.notice.split(/[。；]/)[0]! : undefined;
        archiveActivity("done", notice ? { title: timedTitle(notice) } : undefined);
      }
      // Progressive toolkit batches (partial:true) auto-apply WITHOUT creating
      // a pending plan, so settleToolkit never runs for them. Persist the
      // now-dirty deck/doc here — otherwise applied slides/chapters live only
      // in memory and vanish on reload (real-model PPT repro).
      if (isToolkitScope(req.scope) && appliedIds.size > 0 && !partialApplyFailed) {
        await useEditorStore.getState().save();
      }
      if (allAutoApplied) {
        log("success", "ai", "AI 修改已分批应用并保存");
      } else {
        log("success", "ai", req.mode === "patch" ? "变更计划已生成，等待确认" : "文档已生成，等待确认");
      }
    };
    const onEvent = (ev: ChatEvent): void => {
      // streamChat invokes onEvent synchronously, while a toolkit applier is
      // asynchronous. Serializing event handling lets final dedupe observe only
      // invocations whose local application has completed successfully.
      eventQueue = eventQueue.then(() => handleEvent(ev));
    };
    // Local abort of the in-flight fetch: cancel() aborts this controller so
    // the stream stops even when the server-side cancel request fails.
    const controller = new AbortController();
    set({ abortController: controller });
    try {
      await streamChat(
        {
          projectId: req.projectId,
          messages: attachImages(
            outboundChatMessages(
              // Exclude the just-added streaming placeholder. Toolkit turns have
              // no placeholder (their last message is the user turn), so filter
              // by the streaming flag instead of dropping the last message.
              get().messages.filter((m) => !(m.role === "assistant" && m.streaming)),
            ),
            req.images,
          ),
          mode: req.mode,
          // T21 §3.6: the loop edits the ACTIVE page; undefined = server-side pages[0].
          pageId: (useEditorStore.getState() as { activePageId?: string | null }).activePageId ?? undefined,
          // Frozen P7.3 contract: toolkit projects send {kind,targetIds} in the
          // same field; client.ts's scope type is api-layer-owned (not widened here).
          scope: req.scope as StreamChatBody["scope"],
          // T61 OP-3: variants only on generate (T60 contract); StreamChatBody is
          // api-layer-frozen — the spread bypasses excess-property checks here.
          ...(req.mode === "generate"
            ? { variants: req.variants ?? (draft?.variants || undefined) }
            : {}),
          requestId,
        },
        { onDelta: appendDelta, onEvent },
        controller.signal,
      );
      await eventQueue;
      // Connection closed (server restart/network drop) without any terminal
      // frame — without this the UI sat in "streaming" with the composer locked.
      if (!sawTurnEnd && !controller.signal.aborted && get().requestId === requestId) {
        const message = "连接中断：服务端未返回结束帧，请重试";
        set(toError(message));
        archiveActivity("error", { errorMessage: message });
        finishStreaming();
        log("error", "ai", message);
      }
    } catch (err) {
      const stale = get().requestId !== requestId;
      // Abort we triggered ourselves after a failed partial batch: the error
      // card was already posted; don't overwrite it with a "canceled" card.
      if (err instanceof Error && err.name === "AbortError" && locallyAborted) return;
      // A newer turn/project (clear/new send) has taken over: this dead stream
      // must leave no trace. archiveActivity is a no-op on a cleared activity.
      if (stale) return;
      // User-initiated abort is not an AI failure — no red error bubble.
      if (err instanceof Error && err.name === "AbortError") {
        // Idempotent: a server canceled frame may already have archived it.
        set(withReset({ phase: "idle", requestId: null }));
        archiveActivity("canceled");
        finishStreaming();
        log("info", "ai", "生成已取消（本地中止）");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      set(toError(message));
      archiveActivity("error", { errorMessage: message });
      finishStreaming();
      log("error", "ai", `请求异常：${message}`);
    }
  },

  async confirm(projectId) {
    const plan = get().pendingPlan;
    // P7.3 toolkit plans: replay server-preexecuted commands via the registered
    // applier — the rollback/applyOp linkage below is UI-document-only.
    if (plan?.commands) {
      await confirmToolkitCommands(api, plan.commands);
      return;
    }
    const doc = useEditorStore.getState().document;
    // P7.3: AI 生成/补丁管线只吃 UI 文档——非 ui 项目不会有 pendingPlan，防御性返回。
    if (!plan || !isUiDoc(doc)) return;
    set({ rollbackDoc: doc });
    const pruneSelection = (nextDoc: StudioDocument) => {
      // The AI turn may have deleted selected nodes: don't send a dead id on
      // the next request.
      const activePage = nextDoc.pages[0]!;
      const reachable = new Set(collectSubtreeIds(activePage, activePage.rootId));
      const editor = useEditorStore.getState();
      const selectedId = editor.selectedId && reachable.has(editor.selectedId) ? editor.selectedId : null;
      const selectedIds = editor.selectedIds.filter((id) => reachable.has(id));
      editor.selectNodes(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []);
    };
    if (plan.document) {
      // T61 W3-B: candidate tabs — index 0 = first-round document, i>=1 = alternatives[i-1].
      const tab = get().selectedAlternative;
      const picked = (tab > 0 && plan.alternatives?.length ? plan.alternatives[tab - 1] : null) ?? plan.document;
      const ok = useEditorStore.getState().applyOp(() => picked as StudioDocument);
      if (ok) pruneSelection(picked as StudioDocument);
      log("success", "ai", "已应用生成文档");
      await settleConfirm(projectId, ok, "应用生成文档失败");
    } else if (plan.ops) {
      const ops = plan.ops;
      // All-or-nothing: applyPatch returns the ORIGINAL doc with errors filled on
      // any failure; committing it would mark an unchanged doc dirty — so a failed
      // patch must throw OpError to hit applyOp's abort path.
      let nextDoc: StudioDocument | null = null;
      const ok = useEditorStore.getState().applyOp((d) => {
        const result = applyPatch(d, ops);
        if (result.errors.length > 0) throw new OpError(result.errors.join("; "));
        nextDoc = result.doc;
        return result.doc;
      });
      if (ok && nextDoc) pruneSelection(nextDoc);
      log("success", "ai", `已应用 ${ops.length} 个变更操作`);
      await settleConfirm(projectId, ok, "应用变更失败");
    }
  },

  async acceptCommand(projectId, command) {
    await acceptToolkitCommand(api, command);
  },

  async skipCommand(command) {
    await skipToolkitCommand(api, command);
  },

  setCommandApplier(fn) {
    set({ commandApplier: fn });
  },

  setComposerDraft(projectId, draft) {
    set((s) => ({ composerDrafts: { ...s.composerDrafts, [projectId]: draft } }));
  },

  clearComposerDraft(projectId) {
    set((s) => {
      if (!(projectId in s.composerDrafts)) return s;
      const composerDrafts = { ...s.composerDrafts };
      delete composerDrafts[projectId];
      return { composerDrafts };
    });
  },

  async cancel() {
    const { requestId, abortController } = get();
    // Local abort FIRST + phase reset synchronously: whatever happens to the
    // server-side cancel request below, the UI must always leave "streaming".
    abortController?.abort();
    set((s) => ({
      phase: "idle",
      // Keep requestId: the aborted stream's catch block archives the canceled
      // activity card and then clears it. clear() (project switch) nulls it.
      abortController: null,
      // 流式可见性收尾：取消后阶段行/进度/停滞时钟一并复位
      stage: null,
      progress: null,
      lastFrameAt: null,
      messages: s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
    }));
    // Best-effort server cancel: a failed cancelChat must not resurrect the
    // streaming phase or throw into the caller.
    if (requestId) {
      try {
        await cancelChat(requestId);
      } catch (err) {
        console.warn("[aiStore] cancelChat 失败（流已在本地中止）:", err);
      }
    }
  },

  clear() {
    // Leaving the project / opening another one: ABORT the in-flight stream
    // and tell the server to cancel. Just dropping the controller reference
    // (previous behavior) let old partial frames replay into the new project.
    const { requestId, abortController } = get();
    abortController?.abort();
    if (requestId) bestEffortCancel(requestId);
    set({
      messages: [],
      phase: "idle",
      error: null,
      notice: null,
      requestId: null,
      pendingPlan: null,
      violations: null,
      rollbackDoc: null,
      selectedAlternative: 0,
      toolTrace: [],
      activity: null,
      stage: null,
      progress: null,
      lastFrameAt: null,
      abortController: null,
    });
  },

  modeFor(selection: string | string[] | null, text: string, doc?: StudioDocument | null): ModeDecision {
    return modeFor(selection, text, doc);
  },

  buildScope(doc, selection, extraNodeIds, allowAllTokens) {
    return buildScope(doc, selection, extraNodeIds, allowAllTokens);
  },
  };
});

/** Collapsed-card title prefix for an awaiting-confirm turn (timed suffix added by caller). */
function planTitlePrefix(plan: PendingPlan | undefined): string {
  if (plan?.commands) return `变更计划已生成 · ${plan.commands.length} 条命令`;
  if (plan?.ops) return `变更计划已生成 · ${plan.ops.length} 个操作`;
  if (plan?.document) return "文档已生成";
  return "变更计划已生成";
}

/** Shared confirm epilogue: rollback version + auto-save the applied doc.
 * Auto-save matters for patch flows: server /generate reads the document from
 * disk, so an unsaved AI change would silently generate stale code (found by
 * the P5 E2E: setFrame applied in memory, disk still held the empty doc).
 */
async function settleConfirm(projectId: string, ok: boolean, failMessage: string): Promise<void> {
  if (!ok) {
    useAiStore.setState({ phase: "error", error: failMessage });
    return;
  }
  const { rollbackDoc } = useAiStore.getState();
  if (rollbackDoc) {
    try {
      await saveVersion(projectId, "AI 回退点", rollbackDoc);
    } catch (err) {
      console.error("[aiStore] 回退点版本保存失败:", err);
    }
  }
  useAiStore.setState({ phase: "idle", pendingPlan: null, selectedAlternative: 0 });
  // Persist the applied document (no-op unless dirty); save() owns its own
  // error surface (editorStore.error), so failures are not swallowed silently.
  await useEditorStore.getState().save();
}
