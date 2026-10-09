import type { ProjectMeta } from "@studio/schema-core";
import { useState } from "react";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore, isUiDoc } from "../../state/editorStore";
import { getToolkitSelection, resolveToolkitRequestScope } from "../../toolkits/registry";
import { log } from "../../state/logStore";
import { saveBeforeExport } from "../../state/saveBeforeExport";
import { usePptEditorStore } from "../../toolkits/ppt/state";
import { useWordEditorStore } from "../../toolkits/word/state";
import type { ToolkitScope } from "./types";
import type { SessionRecord } from "../../db/db";
import { selectionChips, selectedNodes } from "./selectionChips";
import { buildScope, modeFor } from "./intent";
import { scopeChip, scopeTraceLine } from "./scopeNotice";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { SessionHistory } from "./SessionHistory";
import { useStallWarn } from "./stallWatch";

export interface AiChatPanelProps {
  projectId: string;
  /** P7.3: ui keeps the node-selection pipeline; ppt/word use the toolkit scope. */
  projectType?: ProjectMeta["projectType"];
  /** Selected preview node; drives patch-local (selected) vs generate-whole-page. */
  selectedId: string | null;
  /** Canvas multi-select: every selected node joins the AI scope (union). */
  selectedIds?: string[];
  /** W1-B: notified when the user loads a persisted session from the 历史 tab. */
  onReplaySession?: (session: SessionRecord) => void;
}

/** Toolkit send path (P7.3): scope from the toolkit selection PLUS request
 * intent — deck/doc-level wording ("做一页…", "新增章节") widens a container
 * scope to file, otherwise the server-side scope gate rolls every structural
 * command back and the run ends with streamed text but no artifacts.
 * Mode is always patch; text as-is (target markers are the UI mock protocol only). */
async function sendToolkitRequest(
  projectId: string,
  projectType: "ppt" | "word",
  text: string,
  images: string[],
): Promise<void> {
  // The server reads the document from disk to build the model's context and
  // pre-execute commands, so unsaved edits must land first — otherwise the AI
  // works on a stale deck (live repro: imported deck never PUT, then scoped
  // requests failed against the blank starter document).
  const saved = await saveBeforeExport(projectId);
  if (!saved.ok) {
    log("error", "ai", saved.message ?? "保存失败，已阻止发送");
    return;
  }
  const selectionScope = getToolkitSelection(projectType);
  const scope = resolveToolkitRequestScope(projectType, text);
  if (scope.kind === "file" && selectionScope.kind !== "file") {
    log("info", "ai", "检测到整篇/多页结构指令，已按整个文件范围发送（不受当前选中页/章节限制）");
  }
  void useAiStore.getState().send({
    projectId,
    text,
    mode: "patch",
    scope,
    toolkit: projectType,
    images: images.length > 0 ? images : undefined,
  });
}

/** Scope chip for toolkit projects (P7.3): file/container/selection in one line. */
function ToolkitScopeChip({ scope }: { scope: ToolkitScope }) {  const text =
    scope.kind === "file"
      ? "整个文件（未选中目标）"
      : scope.kind === "container"
        ? `容器 ${scope.targetIds[0]?.slice(0, 8) ?? ""}`
        : scope.targetIds.length > 1
          ? `局部 · ${scope.targetIds.length} 个对象`
          : `局部 · 目标 ${scope.targetIds[0]?.slice(0, 8) ?? ""}`;
  const scoped = scope.kind !== "file";
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
      aria-label="AI 作用范围"
      title="范围跟随当前选择；当指令包含新增页/章节或整套生成等结构级意图时，自动按整个文件执行"
    >
      <span className="shrink-0 text-ink-muted">范围</span>
      <span
        className={`min-w-0 truncate rounded px-1.5 py-0.5 ${
          scoped ? "bg-accent-soft font-medium text-accent" : "bg-rail text-ink-soft"
        }`}
      >
        {text}
      </span>
    </div>
  );
}

/** Chat body tabs (W1-B): 对话 = live chat log, 历史 = persisted session replay. */
function ChatTabs({
  projectId,
  historyOpen,
  onToggleHistory,
}: {
  projectId: string;
  historyOpen: boolean;
  onToggleHistory: (open: boolean) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="对话视图切换"
      className="flex shrink-0 items-center gap-1 text-[11px]"
    >
      <button
        type="button"
        role="tab"
        aria-selected={!historyOpen}
        onClick={() => onToggleHistory(false)}
        className={`studio-transition rounded-md px-2 py-0.5 font-medium ${
          historyOpen ? "text-ink-muted hover:text-ink" : "bg-rail text-ink"
        }`}
      >
        对话
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={historyOpen}
        onClick={() => onToggleHistory(true)}
        className={`studio-transition rounded-md px-2 py-0.5 font-medium ${
          historyOpen ? "bg-rail text-ink" : "text-ink-muted hover:text-ink"
        }`}
      >
        历史
      </button>
      {historyOpen && <span className="sr-only">正在浏览 {projectId} 的历史会话</span>}
    </div>
  );
}

export function AiChatPanel({
  projectId,
  projectType = "ui",
  selectedId,
  selectedIds,
  onReplaySession,
}: AiChatPanelProps) {
  const phase = useAiStore((s) => s.phase);
  const violations = useAiStore((s) => s.violations);
  const error = useAiStore((s) => s.error);
  const notice = useAiStore((s) => s.notice);
  const lastFrameAt = useAiStore((s) => s.lastFrameAt);
  // W1-B: history tab toggles the chat body between live log and session replay.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Toolkit selection slices: subscribing keeps the scope chip live on selection
  // changes; the scope itself is recomputed fresh at render and send time.
  usePptEditorStore((s) => s.selectedSlideId);
  usePptEditorStore((s) => s.selectedObjectIds);
  useWordEditorStore((s) => s.selection);
  const { stalled, seconds } = useStallWarn(lastFrameAt, phase);
  const document = useEditorStore((s) => s.document);
  // G1: the AI scope follows the ACTIVE page (null resolves to pages[0]).
  const activePageId = useEditorStore((s) => s.activePageId);
  const uiDocument = isUiDoc(document) ? document : null; // P7.3: chat pipeline is UI-only
  const selectionIds = selectedIds?.length
    ? selectedIds
    : selectedId
      ? [selectedId]
      : [];
  // Selection resolved against the active page: stale ids (page switch, node
  // rebuilt by an AI patch) drop out instead of reaching into another page.
  const resolvedNodes = projectType === "ui" && uiDocument
    ? selectedNodes(uiDocument, selectionIds, activePageId)
    : [];
  const toolkitScope =
    projectType === "ppt" || projectType === "word" ? getToolkitSelection(projectType) : null;
  const handleSend = (text: string, images: string[]): void => {
    if (projectType === "ppt" || projectType === "word") {
      sendToolkitRequest(projectId, projectType, text, images);
      return;
    }
    const store = useAiStore.getState();
    const selection = selectionIds.length > 0 ? selectionIds : null;
    // uiDocument participates so a blank project always generates: a scoped
    // patch on an empty canvas has nothing to write to (regression).
    // Q3 (design §8): direct intent.ts calls — aiStore's forwarding signature
    // has no pageId tail and the store is off-limits; these are thin forwards.
    const decision = modeFor(selection, text, uiDocument, activePageId);
    // Generate is whole-page by definition: sending a selection scope along
    // made the server gate every write ("节点 <id> 超出修改范围") and the canvas
    // stayed empty. Patch keeps its scope (strictness unchanged); toolkit scope
    // shapes are handled by the branch above and never reach here.
    const scope =
      decision.mode === "generate"
        ? undefined
        : buildScope(uiDocument, selection, decision.markerNodeIds, decision.allowAllTokens, activePageId);
    void store.send({
      projectId,
      text: decision.text,
      mode: decision.mode,
      scope,
      images: images.length > 0 ? images : undefined,
    });
    // G3 (main plan): display-only scope trace via event bypass — never enters
    // ChatLogMessage.text, so it cannot leak into outbound context (§8-Q6).
    // Whole-page turns (generate) record no trace line.
    const trace = decision.mode === "generate" ? null : scopeTraceLine(resolvedNodes.length);
    window.dispatchEvent(new CustomEvent("studio-ai-scope-trace", { detail: trace }));
  };

  const pickSuggestion = (text: string): void => {
    // The composer owns its text state; deliver via a custom event so the
    // suggestion click lands in the textarea for further editing.
    window.dispatchEvent(new CustomEvent("studio-ai-prefill", { detail: text }));
  };

  // W1-A quick actions: per-type chips shown only for UI projects with a
  // selection (active-page resolved). Toolkit projects keep their header.
  const chips = projectType === "ui" ? selectionChips(resolvedNodes) : [];
  // G2: scope chip model — stale selections already degraded to "whole" above.
  const scopeInfo = scopeChip(
    resolvedNodes.length,
    resolvedNodes[0]?.type ?? null,
    resolvedNodes[0]?.id ?? null,
  );

  return (
    <section aria-label="AI 对话" className="flex min-h-0 flex-1 flex-col gap-2 text-xs">
      <div className="flex shrink-0 items-center justify-between">
        {/* Scope chip: makes the next request's reach visible before sending. */}
        {toolkitScope ? (
          <ToolkitScopeChip scope={toolkitScope} />
        ) : (
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2 py-1.5 text-[11px]"
            aria-label="AI 作用范围"
            title={scopeInfo.hint}
          >
            <span className="shrink-0 text-ink-muted">范围</span>
            <span
              className={`min-w-0 truncate rounded px-1.5 py-0.5 ${
                scopeInfo.kind === "partial"
                  ? "bg-accent-soft font-medium text-accent"
                  : "bg-rail text-ink-soft"
              }`}
            >
              {scopeInfo.label}
            </span>
            {/* G2: explicit exit from selection-scoped mode (ui branch only). */}
            {scopeInfo.kind === "partial" && (
              <button
                type="button"
                aria-label="清除选中范围"
                title="清除选中，恢复整页范围"
                onClick={() => useEditorStore.getState().selectNode(null)}
                className="studio-transition shrink-0 rounded px-1 text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <ChatTabs projectId={projectId} historyOpen={historyOpen} onToggleHistory={setHistoryOpen} />
      </div>
      <div
        role="log"
        aria-label="AI 对话"
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline bg-surface p-3"
      >
        {historyOpen ? (
          <SessionHistory
            projectId={projectId}
            onReplay={(s) => {
              // Replay is read-only: surface the session to the host, then
              // return to the live chat view.
              onReplaySession?.(s);
              setHistoryOpen(false);
            }}
          />
        ) : (
          <MessageList onPickSuggestion={pickSuggestion} selectedId={selectedId} />
        )}
      </div>
      {phase === "streaming" && stalled && (
        <div
          role="alert"
          className="rounded-lg border border-warn/30 bg-warn-soft p-2 text-warn"
        >
          已 {seconds} 秒没有新数据——模型可能卡住或网络中断，可点取消后重试
        </div>
      )}
      {violations && violations.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-warn/30 bg-warn-soft p-2 text-warn"
        >
          <p className="font-medium">范围拦截：以下操作超出允许范围（已自动重试）</p>
          <ul className="list-disc pl-4">
            {violations.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger-soft p-2 text-danger"
        >
          {error}
        </div>
      )}
      {!error && notice && (
        <div
          role="status"
          className="rounded-lg border border-hairline bg-canvas p-2 text-ink-soft"
        >
          {notice}
        </div>
      )}
      {chips.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5" aria-label="选中快捷操作">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              title={chip.text}
              onClick={() => pickSuggestion(chip.text)}
              className="studio-transition rounded-full border border-hairline bg-surface px-2.5 py-1 text-[11px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      <Composer
        projectId={projectId}
        disabled={phase === "streaming"}
        streaming={phase === "streaming"}
        onSend={handleSend}
        onCancel={() => void useAiStore.getState().cancel()}
        selectedNodes={resolvedNodes}
      />
    </section>
  );
}
