import {
  attachPoint,
  duplicateNode,
  getComponentDef,
  insertNode,
  makeNode,
  moveNode,
  newNodeId,
  removeNode,
  setToken,
  updateProps,
} from "@studio/schema-core";
import type { Frame, Page, ProjectMeta, StudioDocument, TokenPath } from "@studio/schema-core";
import type { PptDocument } from "@studio/ppt-toolkit";
import type { WordDocument } from "@studio/word-toolkit";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VersionPanel } from "./components/editor/VersionPanel";
import { WorkbenchLayout } from "./components/layout/WorkbenchLayout";
import { PageShell } from "./components/motion";
import { CommandPalette, insertCommands, type PaletteCommand } from "./components/palette/CommandPalette";
import type { PreviewMode } from "./preview/PreviewSurface";
import { SettingsDialog } from "./features/ai/SettingsDialog";
import { startSessionPersistence } from "./features/ai/sessionStore";
import { CodePanel } from "./features/codegen/CodePanel";
import { ProjectListScreen } from "./features/projects/ProjectListScreen";
import { VisualPanel } from "./features/visual/VisualPanel";
import { PptEditorPanel } from "./toolkits/ppt/PptEditorPanel";
import { WordEditorPanel } from "./toolkits/word/WordEditorPanel";
import { applyPptAiCommands, usePptEditorStore } from "./toolkits/ppt/state";
import { applyWordAiCommands, useWordEditorStore } from "./toolkits/word/state";
import { loadVersions, removeVersion, saveVersion } from "./state/versionStore";
import type { VersionListItem } from "./state/versionStore";
import { useAiStore } from "./state/aiStore";
import { useClipboardStore } from "./state/clipboardStore";
import { useCodegenStore } from "./state/codegenStore";
import { useEditorStore, isUiDoc } from "./state/editorStore";
import { log } from "./state/logStore";
import { useVisualStore } from "./state/visualStore";
import { usePageTabs } from "./features/canvas/usePageTabs";

/**
 * Insert target: the selected node when it is a container, else its parent,
 * else the document root. Non-container selection nests into the parent.
 */
function insertTargetId(doc: Page, selectedId: string | null): string {
  if (!selectedId) return doc.rootId;
  const def = getComponentDef(doc.nodes.find((n) => n.id === selectedId)?.type ?? "");
  if (def?.container) return selectedId;
  const attach = attachPoint(doc, selectedId);
  return attach?.parentId ?? doc.rootId;
}


/** Cascading drop frame for canvas-mode inserts: 280x160 at a 24px diagonal offset. */
function canvasDropFrame(doc: Page, id: string): Frame {
  const framed = doc.nodes.filter((n) => n.frame);
  const maxRight = Math.max(0, ...framed.map((n) => n.frame!.x + n.frame!.w));
  const count = framed.length;
  return { x: maxRight + 24, y: 24 + (count % 8) * 24, w: 280, h: 160, rotation: 0 };
}

function undoCurrentHistory(projectType: ProjectMeta["projectType"]): void {
  if (projectType === "ppt") {
    usePptEditorStore.getState().undo();
    return;
  }
  if (projectType === "word") {
    useWordEditorStore.getState().undo();
    return;
  }
  useEditorStore.getState().undo();
}

function redoCurrentHistory(projectType: ProjectMeta["projectType"]): void {
  if (projectType === "ppt") {
    usePptEditorStore.getState().redo();
    return;
  }
  if (projectType === "word") {
    useWordEditorStore.getState().redo();
    return;
  }
  useEditorStore.getState().redo();
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  // Color inputs commit one discrete token edit through the document history;
  // they are controls, not text editors, so global undo must remain available.
  if (element.tagName === "INPUT" && (element as HTMLInputElement).type === "color") return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || Boolean(element.isContentEditable);
}

// Rules of hooks: usePageTabs must run on every render; with no ui document
// open its result is discarded (EMPTY_TAB_DOC never renders).
const EMPTY_TAB_DOC = { documentVersion: 2, name: "", tokens: {}, pages: [] } as unknown as StudioDocument;

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionListItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("schema");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const meta = useEditorStore((s) => s.meta);
  const document = useEditorStore((s) => s.document);
  const projectType = meta?.projectType ?? "ui";
  const isUiProject = projectType === "ui";
  const dirty = useEditorStore((s) => s.dirty);
  const saving = useEditorStore((s) => s.saving);
  const error = useEditorStore((s) => s.error);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const viewport = useEditorStore((s) => s.viewport);
  const uiCanUndo = useEditorStore((s) => s.canUndo);
  const uiCanRedo = useEditorStore((s) => s.canRedo);
  const pptCanUndo = usePptEditorStore((s) => projectType === "ppt" && s.past.length > 0);
  const pptCanRedo = usePptEditorStore((s) => projectType === "ppt" && s.future.length > 0);
  const wordCanUndo = useWordEditorStore((s) => projectType === "word" && s.past.length > 0);
  const wordCanRedo = useWordEditorStore((s) => projectType === "word" && s.future.length > 0);
  const canUndo = projectType === "ui" ? uiCanUndo : projectType === "ppt" ? pptCanUndo : wordCanUndo;
  const canRedo = projectType === "ui" ? uiCanRedo : projectType === "ppt" ? pptCanRedo : wordCanRedo;
  const openProject = useEditorStore((s) => s.openProject);
  const save = useEditorStore((s) => s.save);
  const clipboardPayload = useClipboardStore((s) => s.payload);

  // P7.3: 非项目 UI 面板守卫——ppt/word 项目只渲染工作台壳（TopBar 保存/改名 + 左侧
  // 项目需求 + 占位编辑器），UI 编辑面板（预览/右栏/版本对比导入导出/代码生成/截图）不参与。
  const uiDocument = isUiDoc(document) ? document : null;
  // T19 §3.4: page tabs (hook must run unconditionally; EMPTY_TAB_DOC is
  // a stand-in for renders with no ui document — its result is never threaded).
  const activePageId = useEditorStore((s) => s.activePageId);
  const pageTabs = usePageTabs({ doc: uiDocument ?? EMPTY_TAB_DOC, activePageId });

  const reloadVersions = useCallback(async (id: string) => {
    try {
      setVersions(await loadVersions(id));
    } catch (err) {
      console.error("[App] 版本列表加载失败:", err);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      void openProject(projectId);
      void reloadVersions(projectId);
    }
  }, [projectId, openProject, reloadVersions]);

  // W1-B: mirror terminal AI turns into the Dexie sessions table once per app
  // run. startSessionPersistence is idempotent (StrictMode-safe) and its
  // cleanup unsubscribes on unmount.
  useEffect(() => startSessionPersistence(), []);

  // Guard against losing unsaved edits on tab close/refresh (dirty → browser confirm).
  // Handler identity is stable; cleanup removes it again (StrictMode double-invoke safe).
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = ""; // Chrome requires a non-empty returnValue to show the prompt
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** Shared op helper bound to the current selection/document. */
  const applyOp = useEditorStore.getState().applyOp;
  // T19 §3.3: node ops run on the ACTIVE page via the store funnel (one undo entry).
  const applyPageOp = useEditorStore.getState().applyPageOp;
  const handleSelect = (id: string) => useEditorStore.getState().selectNode(id);
  const handleSetViewport = (v: typeof viewport) => useEditorStore.getState().setViewport(v);
  const handleSetToken = (path: TokenPath, value: string | number) =>
    applyOp((doc) => setToken(doc, path, value));
  const handlePropsChange = (props: Record<string, unknown>) => {
    const id = useEditorStore.getState().selectedId;
    if (id) applyPageOp((page) => updateProps(page, id, props));
  };
  const handleInsert = (type: string) => {
    const s = useEditorStore.getState();
    if (!isUiDoc(s.document)) return; // P7.3: UI insert only for ui projects
    const target = insertTargetId(s.document.pages[0]!, s.selectedId);
    const node = makeNode(type);
    // Canvas mode: a frameless node would be invisible on the canvas (only
    // frame-bearing nodes render there), so give the insert a cascading frame.
    if (previewMode === "canvas") {
      const framed = { ...node, frame: canvasDropFrame(s.document.pages[0]!, node.id) };
      applyPageOp((page) => insertNode(page, framed, target));
      return;
    }
    applyPageOp((page) => insertNode(page, node, target));
  };
  const handleRemove = (id: string) => applyPageOp((page) => removeNode(page, id));
  const handleMove = (id: string, newParentId: string, index: number) =>
    applyPageOp((page) => moveNode(page, id, newParentId, index));

  const handleCopy = useCallback(() => {
    const s = useEditorStore.getState();
    const id = s.selectedId;
    if (!isUiDoc(s.document) || !id) return; // P7.3: UI-only op
    const node = s.document.pages[0]!.nodes.find((n) => n.id === id);
    const title = node ? (getComponentDef(node.type)?.title ?? node.type) : "节点";
    useClipboardStore.getState().copyFromDoc(s.document.pages[0]!, id, title);
    log("success", "system", `已复制「${title}」到剪贴板（Ctrl+V 粘贴）`);
  }, []);

  const handleDuplicate = useCallback(() => {
    const s = useEditorStore.getState();
    const id = s.selectedId;
    if (!isUiDoc(s.document) || !id) return; // P7.3: UI-only op
    const node = s.document.pages[0]!.nodes.find((n) => n.id === id);
    const title = node ? (getComponentDef(node.type)?.title ?? node.type) : "节点";
    const ok = applyPageOp((page) => duplicateNode(page, id));
    if (ok) log("success", "system", `已复制一份「${title}」`);
  }, [applyOp]);

  const handlePaste = useCallback(() => {
    const s = useEditorStore.getState();
    const payload = useClipboardStore.getState().payload;
    if (!isUiDoc(s.document) || !payload) return; // P7.3: UI-only op
    const target = insertTargetId(s.document.pages[0]!, s.selectedId);
    let pastedId = payload.rootId;
    const ok = applyPageOp((page) => {
      // Fresh ids on every paste so repeats never collide.
      const idMap = new Map<string, string>();
      for (const n of payload.nodes) idMap.set(n.id, newNodeId());
      const remapped = payload.nodes.map((n) => ({
        ...n,
        id: idMap.get(n.id)!,
        props: JSON.parse(JSON.stringify(n.props ?? {})) as Record<string, unknown>,
        children: n.children.filter((c) => idMap.has(c)).map((c) => idMap.get(c)!),
        ...(n.frame ? { frame: { ...n.frame } } : {}),
      }));
      const newRootId = idMap.get(payload.rootId)!;
      pastedId = newRootId;
      const newRoot = remapped.find((n) => n.id === newRootId)!;
      return insertNode(page, newRoot, target, undefined, remapped);
    });
    if (ok) {
      useEditorStore.getState().selectNode(pastedId);
      log("success", "system", `已粘贴「${payload.label}」`);
    }
  }, [applyOp]);

  // Palette open change: rebuild after handlers exist.
  useEffect(() => {
    if (!projectId) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void useEditorStore.getState().save();
        return;
      }
      if (mod && (e.key.toLowerCase() === "z" || e.code === "KeyZ")) {
        if (isTextEditingTarget(e.target)) return;
        e.preventDefault();
        const currentProjectType = useEditorStore.getState().meta?.projectType ?? "ui";
        if (e.shiftKey) redoCurrentHistory(currentProjectType);
        else undoCurrentHistory(currentProjectType);
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        // Only when not typing in a field (browser copy still works there).
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        handleCopy();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        handlePaste();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectId, handleCopy, handleDuplicate, handlePaste]);

  // Project-list shortcuts: still allow palette? No — palette is editor-only.
  useEffect(() => {
    if (projectId) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectId]);

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    if (!projectId) return [];
    const actions: PaletteCommand[] = [
      { id: "save", title: "保存文档", group: "文档", hint: "Ctrl+S", run: () => void useEditorStore.getState().save() },
      { id: "undo", title: "撤销", group: "文档", hint: "Ctrl+Z", enabled: canUndo, run: () => undoCurrentHistory(projectType) },
      { id: "redo", title: "重做", group: "文档", hint: "Ctrl+Shift+Z", enabled: canRedo, run: () => redoCurrentHistory(projectType) },
      { id: "copy", title: "复制选中节点", group: "节点", hint: "Ctrl+C", enabled: Boolean(selectedId), run: handleCopy },
      { id: "paste", title: "粘贴到选中/根", group: "节点", hint: "Ctrl+V", enabled: Boolean(clipboardPayload), run: handlePaste },
      { id: "dup", title: "复制一份（duplicate）", group: "节点", hint: "Ctrl+D", enabled: Boolean(selectedId), run: handleDuplicate },
      { id: "del", title: "删除选中节点", group: "节点", enabled: Boolean(selectedId), run: () => { if (selectedId) handleRemove(selectedId); } },
      { id: "mode-schema", title: "预览模式：Schema", group: "预览", run: () => setPreviewMode("schema") },
      { id: "mode-project", title: "预览模式：项目预览", group: "预览", run: () => setPreviewMode("project") },
      { id: "mode-canvas", title: "预览模式：画布", group: "预览", run: () => setPreviewMode("canvas") },
      { id: "vp-desktop", title: "视口：桌面 1440", group: "预览", run: () => useEditorStore.getState().setViewport("desktop") },
      { id: "vp-tablet", title: "视口：平板 1024", group: "预览", run: () => useEditorStore.getState().setViewport("tablet") },
      { id: "vp-mobile", title: "视口：手机 390", group: "预览", run: () => useEditorStore.getState().setViewport("mobile") },
      { id: "settings", title: "打开模型设置", group: "应用", run: () => setSettingsOpen(true) },
      { id: "back", title: "返回项目列表", group: "应用", run: () => {
        useEditorStore.getState().reset();
        useAiStore.getState().clear();
        useCodegenStore.getState().clear();
        useVisualStore.getState().clear();
        setPreviewMode("schema");
        setVersions([]);
        setProjectId(null);
      } },
    ];
    return [...actions, ...insertCommands(handleInsert)];
  }, [projectId, projectType, canUndo, canRedo, selectedId, clipboardPayload, handleCopy, handlePaste, handleDuplicate, handleInsert, handleRemove]);

  // P9.1: PPT 编辑器保存联动——面板事务成功后把新 deck 写回 editorStore
  // document（联合成员）并置 dirty，保存通道（TopBar 保存/Ctrl+S）即走通。
  // Hooks must stay above the early return below (rules of hooks).
  const handlePptDocumentChange = useCallback((deck: PptDocument) => {
    useEditorStore.setState({ document: deck, dirty: true });
  }, []);

  // P10.1: Word 编辑器保存联动——面板事务成功后把新文档写回 editorStore
  // document（联合成员）并置 dirty，保存通道（TopBar 保存/Ctrl+S）即走通。
  const handleWordDocumentChange = useCallback((doc: WordDocument) => {
    useEditorStore.setState({ document: doc, dirty: true });
  }, []);

  // 非 UI 项目由各自工具包持有文档与撤销历史；顶栏改名必须走同一条事务状态链。
  const handleDocumentNameChange = useCallback((name: string) => {
    if (projectType === "ppt") {
      const pptStore = usePptEditorStore.getState();
      const nextDeck = pptStore.setDocumentName(name);
      if (nextDeck) {
        if (useEditorStore.getState().document !== nextDeck) {
          useEditorStore.setState({ document: nextDeck, dirty: true });
        }
        return;
      }
    }
    if (projectType === "word") {
      const wordStore = useWordEditorStore.getState();
      const nextDoc = wordStore.setDocumentName(name);
      if (nextDoc) {
        if (useEditorStore.getState().document !== nextDoc) {
          useEditorStore.setState({ document: nextDoc, dirty: true });
        }
        return;
      }
    }
    useEditorStore.getState().setDocumentName(name);
  }, [projectType]);

  // P7.3: toolkit AI 命令 applier 注册——ppt/word 编辑器 store 负责本地重放，
  // aiStore.confirm/acceptCommand 通过它整体应用 done 帧命令；UI 项目清空。
  useEffect(() => {
    const applier =
      projectType === "ppt"
        ? applyPptAiCommands
        : projectType === "word"
          ? applyWordAiCommands
          : null;
    useAiStore.getState().setCommandApplier(applier);
    return () => useAiStore.getState().setCommandApplier(null);
  }, [projectType]);

  if (!projectId) {
    return (
      <>
        <PageShell pageKey="home">
          <ProjectListScreen onOpen={setProjectId} />
        </PageShell>
      </>
    );
  }

  // Restore/import go through applyOp: undo-able and marked dirty.
  const handleRestore = (doc: NonNullable<typeof uiDocument>) => applyOp(() => doc);
  const handleImport = (doc: NonNullable<typeof uiDocument>) => applyOp(() => doc);
  const handleSaveVersion = (pid: string, name: string) => {
    const doc = useEditorStore.getState().document;
    if (!doc) throw new Error("当前无可保存文档");
    // 版本接口当前只接受 UI 文档（server createVersionBodySchema 钉 pageDocumentSchema）
    if (!isUiDoc(doc)) throw new Error("仅 UI 项目支持版本快照");
    return saveVersion(pid, name, doc);
  };
  const handleDeleteVersion = async (pid: string, versionId: string) => {
    await removeVersion(pid, versionId);
    await reloadVersions(pid);
  };
  // AI confirm: apply via aiStore (editorStore.applyOp + rollback version inside).
  // The rollback version is written by aiStore, so the list must be reloaded here
  // or 版本历史/版本对比 stay empty until the next manual refresh.
  const handleConfirmPlan = (pid: string) => {
    void useAiStore
      .getState()
      .confirm(pid)
      .then(() => reloadVersions(pid));
  };

  // P4-3: bottom dock "本地质检" slot (only meaningful with a project open).
  const visualPanel: React.ReactNode = <VisualPanel projectId={projectId} />;

  return (
    <>
      <PageShell pageKey={`project:${projectId}`}>
        <WorkbenchLayout
          projectName={meta?.name ?? ""}
          documentName={document?.name ?? ""}
          dirty={dirty}
          saving={saving}
          error={error}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => undoCurrentHistory(projectType)}
          onRedo={() => redoCurrentHistory(projectType)}
          onOpenSettings={() => setSettingsOpen(true)}
          projectId={projectId}
          onConfirmPlan={handleConfirmPlan}
          meta={meta}
          /* P7.3: 非 ui 项目不向 UI 面板传文档——Center/RightPanel 收 null 渲染空态；
             占位编辑器由 editorSlot 接管（下方）。 */
          document={uiDocument}
          selectedId={isUiProject ? selectedId : null}
          selectedIds={isUiProject ? selectedIds : []}
          viewport={viewport}
          onSelect={handleSelect}
          onSetViewport={handleSetViewport}
          onSetToken={handleSetToken}
          onPropsChange={handlePropsChange}
          onInsert={handleInsert}
          onRemove={handleRemove}
          onMove={handleMove}
          onDocumentNameChange={handleDocumentNameChange}
          onSave={() => void save()}
          editorSlot={
            !isUiProject ? (
              projectType === "ppt" && document && meta ? (
                <PptEditorPanel
                  document={document as PptDocument}
                  meta={meta}
                  onDocumentChange={handlePptDocumentChange}
                />
              ) : projectType === "word" && document && meta ? (
                /* P10.1: word 分支替换 P7.3 占位 div——WordEditorPanel 接管。 */
                <WordEditorPanel
                  document={document as WordDocument}
                  meta={meta}
                  onDocumentChange={handleWordDocumentChange}
                />
              ) : (
                <div
                  aria-label="工具包编辑器占位"
                  className="m-auto flex max-w-md flex-col items-center gap-2 px-6 text-center"
                >
                  <p className="text-sm font-medium text-ink">编辑器开发中</p>
                  <p className="text-xs leading-relaxed text-ink-muted">
                    当前可修改文档名称并保存；编辑面板将在该工具包接入后开放。
                  </p>
                </div>
              )
            ) : undefined
          }
          versionPanel={
            <VersionPanel
              projectId={projectId}
              versions={versions}
              document={uiDocument}
              /* 非 ui 项目禁用「存为版本」（版本接口只接受 UI 文档）——传 undefined
                 使按钮 disabled；列表/删除仍可用。 */
              onSaveVersion={isUiProject ? handleSaveVersion : undefined}
              onDeleteVersion={handleDeleteVersion}
              onReloadVersions={() => reloadVersions(projectId)}
              onRestore={handleRestore}
              onImport={handleImport}
            />
          }
          codePanel={isUiProject ? <CodePanel projectId={projectId} /> : undefined}
          visualPanel={isUiProject ? visualPanel : undefined}
              previewMode={previewMode}
              onSetPreviewMode={setPreviewMode}
              tabs={uiDocument ? pageTabs : undefined}
              onOpenPalette={() => setPaletteOpen(true)}
          onBack={() => {
            useEditorStore.getState().reset();
            useAiStore.getState().clear(); // AI 会话与项目生命周期一致
            useCodegenStore.getState().clear(); // 生成/预览/导出状态同项目生命周期
            useVisualStore.getState().clear(); // 本地质检结果同项目生命周期
            setPreviewMode("schema");
            setVersions([]);
            setProjectId(null);
          }}
          settingsDialog={<SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
        />
      </PageShell>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
      />
    </>
  );
}
