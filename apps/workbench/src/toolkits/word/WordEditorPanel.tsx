import type { ProjectMeta } from "@studio/schema-core";
import type { WordDocument } from "@studio/word-toolkit";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NarrowDrawer } from "../../components/layout/NarrowDrawer";
import { Presence } from "../../components/motion";
import { PanelToggleButton } from "../../components/layout/PanelToggleButton";
import { useBreakpoint } from "../../utils/useBreakpoint";
import { DocumentCanvas } from "./DocumentCanvas";
import { OutlinePanel, QUICK_BLOCK_PRESETS } from "./OutlinePanel";
import { manualInvocation, runWordCommands, useWordEditorStore } from "./state";
import { WordAuxRail } from "./WordAuxRail";
import { ExportPanel } from "./ExportPanel";
import { QualityPanel } from "./QualityPanel";
import { PrintPreview } from "./PrintPreview";
import { api } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";

export interface WordEditorPanelProps {
  document: WordDocument;
  meta: ProjectMeta;
  /** App wiring: write the edited document back into editorStore (marks dirty). */
  onDocumentChange: (doc: WordDocument) => void;
}

/**
 * Insert a block next to the current selection (after the selected block in its
 * section); with no selection, append to the first section.
 */
function insertRelative(payload: unknown): void {
  const store = useWordEditorStore.getState();
  const doc = store.doc;
  if (!doc) return;
  const anchor = store.selection.blockIds[0] ?? store.selection.blockId;
  const owner = anchor ? doc.sections.find((s) => s.blockIds.includes(anchor)) : undefined;
  if (anchor && owner) {
    const index = owner.blockIds.indexOf(anchor) + 1;
    runWordCommands([manualInvocation("word.block.insert", { block: payload, sectionId: owner.id, index })]);
    return;
  }
  const sectionId = doc.sections[0]?.id;
  if (!sectionId) return;
  runWordCommands([manualInvocation("word.block.insert", { block: payload, sectionId })]);
}

/** Generate the TOC: insert a tocPlaceholder when absent, then word.toc.generate. */
function generateToc(doc: WordDocument): void {
  const existing = doc.blocks.find((block) => block.type === "tocPlaceholder");
  if (existing) {
    runWordCommands([manualInvocation("word.toc.generate", { tocBlockId: existing.id })]);
    return;
  }
  const sectionId = doc.sections[0]?.id;
  if (!sectionId) return;
  const tocBlockId = `toc_${Date.now().toString(36)}`;
  runWordCommands([
    manualInvocation("word.block.insert", { block: { type: "tocPlaceholder" }, blockId: tocBlockId, sectionId }),
    manualInvocation("word.toc.generate", { tocBlockId }),
  ]);
}

/**
 * Top toolbar: quick block inserts (relative to selection) + real image upload
 * + section ops + TOC. Undo/redo stay in TopBar.
 */
function EditorToolbar({ doc }: { doc: WordDocument }) {
  const error = useWordEditorStore((s) => s.error);
  const clearError = useWordEditorStore((s) => s.clearError);
  const projectId = useEditorStore((s) => s.projectId);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const uploadImage = async (file: File | undefined) => {
    if (!file || !projectId) return;
    setBusy(true);
    try {
      const uploaded = await api.uploadPptAsset(projectId, file);
      insertRelative({ type: "image", src: uploaded.src, width: 300 });
    } finally {
      setBusy(false);
    }
  };

  // The image preset previously wrote a fake src="placeholder"; exclude it —
  // real images come through the upload button (AI can see the asset too).
  const presets = QUICK_BLOCK_PRESETS.filter((preset) => preset.type !== "image");

  return (
    <div role="toolbar" aria-label="Word 编辑工具条" className="flex shrink-0 flex-wrap items-center gap-1 border-b border-hairline bg-rail px-3 py-1.5 text-xs">
      <span className="mr-1 font-semibold text-ink-soft">插入：</span>
      {presets.map((preset) => (
        <button
          key={preset.type}
          type="button"
          aria-label={`插入${preset.label}`}
          className="rounded-sm px-1.5 py-0.5 text-ink-muted hover:bg-surface hover:text-ink"
          onClick={() => insertRelative(preset.payload)}
        >
          {preset.label}
        </button>
      ))}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        aria-label="选择图片文件"
        onChange={(e) => {
          void uploadImage(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label="插入图片"
        disabled={busy || !projectId}
        className="rounded-sm border border-hairline px-2 py-0.5 text-ink-soft hover:bg-surface disabled:opacity-50"
        onClick={() => imageInputRef.current?.click()}
      >
        {busy ? "上传中…" : "图片"}
      </button>
      <button
        type="button"
        aria-label="生成目录"
        className="ml-2 rounded-sm border border-hairline px-2 py-0.5 text-ink-soft hover:bg-surface hover:text-ink"
        onClick={() => generateToc(doc)}
      >
        生成目录
      </button>
      <span className="flex-1" />
      {error && (
        <button type="button" aria-label="错误提示" className="rounded-sm bg-danger-soft px-2 py-0.5 text-danger" onClick={clearError}>
          {error} ✕
        </button>
      )}
    </div>
  );
}

/**
 * Word editor panel (P10.1): outline + A4 paged canvas + single aux rail
 * (style/review tabs). All edits go through word-toolkit transactions
 * (manual source).
 */
export function WordEditorPanel({ document, meta, onDocumentChange }: WordEditorPanelProps) {
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [sectionNameDrafts, setSectionNameDrafts] = useState<Record<string, string>>({});

  // Props → store sync; same-reference props are no-ops (open/switch resets history).
  useEffect(() => {
    useWordEditorStore.getState().syncDocument(document);
  }, [document]);
  useEffect(() => {
    useWordEditorStore.getState().setOnChange(onDocumentChange);
  }, [onDocumentChange]);

  const doc = useWordEditorStore((s) => s.doc) ?? document;
  const breakpoint = useBreakpoint();
  const [narrowRail, setNarrowRail] = useState<"outline" | "aux" | "print-preview" | null>(null);

  // A drawer only exists in narrow mode. Clear its transient open state in a
  // layout effect so a breakpoint transition cannot race a subsequent click.
  useLayoutEffect(() => {
    if (breakpoint !== "narrow") setNarrowRail(null);
  }, [breakpoint]);

  const selectFromOutline = useCallback((blockId: string) => {
    useWordEditorStore.getState().selectBlock(blockId);
  }, []);

  const selectedBlockId = useWordEditorStore((s) => s.selection.blockId);
  const commentDraftKey = selectedBlockId ? `${meta.id}:${selectedBlockId}` : null;
  const commentDraft = commentDraftKey ? commentDrafts[commentDraftKey] ?? "" : "";
  const setCommentDraft = useCallback((draft: string) => {
    const blockId = useWordEditorStore.getState().selection.blockId;
    if (!blockId) return;
    const key = `${meta.id}:${blockId}`;
    setCommentDrafts((current) => ({ ...current, [key]: draft }));
  }, [meta.id]);

  const setSectionNameDraft = useCallback((sectionId: string, draft: string | undefined) => {
    const key = `${meta.id}:${sectionId}`;
    setSectionNameDrafts((current) => {
      if (draft === undefined) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: draft };
    });
  }, [meta.id]);

  const outlinePanel = (embedded = false) => (
    <OutlinePanel
      doc={doc}
      onSelectBlock={selectFromOutline}
      sectionNameDrafts={Object.fromEntries(
        Object.entries(sectionNameDrafts)
          .filter(([key]) => key.startsWith(`${meta.id}:`))
          .map(([key, draft]) => [key.slice(meta.id.length + 1), draft]),
      )}
      onSectionNameDraftChange={setSectionNameDraft}
      embedded={embedded}
    />
  );
  const auxRail = (embedded = false) => (
    <WordAuxRail
      doc={doc}
      onLocateBlock={selectFromOutline}
      commentDraft={commentDraft}
      onCommentDraftChange={setCommentDraft}
      embedded={embedded}
    />
  );

  return (
    <div aria-label="Word 编辑器" className="flex min-h-0 min-w-0 flex-1 flex-col bg-rail">
      <EditorToolbar doc={doc} />
      <div data-word-editor-content className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {breakpoint === "narrow" ? (
          <>
            <PanelToggleButton
              side="left"
              variant="strip"
              label="切换文档大纲"
              expanded={narrowRail === "outline"}
              onClick={() => setNarrowRail((current) => (current === "outline" ? null : "outline"))}
            />
            <DocumentCanvas doc={doc} />
            <PanelToggleButton
              side="right"
              variant="strip"
              label="切换辅助栏"
              expanded={narrowRail === "aux"}
              onClick={() => setNarrowRail((current) => (current === "aux" ? null : "aux"))}
            />
            <Presence when={narrowRail === "outline"}>
              <NarrowDrawer
                key="word-outline"
                side="left"
                label="文档大纲"
                onClose={() => setNarrowRail(null)}
                focusFallback={() =>
                  globalThis.document.querySelector<HTMLElement>('[aria-label="文档大纲"] button')
                    ?? globalThis.document.querySelector<HTMLElement>('[aria-label="Word 编辑工具条"] button')
                }
              >
                <div data-word-narrow-drawer-content className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto">
                  {outlinePanel(true)}
                </div>
              </NarrowDrawer>
            </Presence>
            <Presence when={narrowRail === "aux"}>
              <NarrowDrawer
                key="word-aux"
                side="right"
                label="辅助栏"
                onClose={() => setNarrowRail(null)}
                focusFallback={() =>
                  globalThis.document.querySelector<HTMLElement>('[aria-label="辅助栏"] button')
                    ?? globalThis.document.querySelector<HTMLElement>('[aria-label="Word 编辑工具条"] button')
                }
              >
                <div data-word-narrow-drawer-content className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto">
                  {auxRail(true)}
                </div>
              </NarrowDrawer>
            </Presence>
            <Presence when={narrowRail === "print-preview"}>
              <NarrowDrawer
                key="word-print-preview"
                side="right"
                label="打印预览"
                onClose={() => setNarrowRail(null)}
                focusFallback={() =>
                  globalThis.document.querySelector<HTMLElement>('[aria-label="打开打印预览"]')
                    ?? globalThis.document.querySelector<HTMLElement>('[aria-label="Word 编辑工具条"] button')
                }
              >
                <div data-word-narrow-drawer-content className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto">
                  <PrintPreview />
                </div>
              </NarrowDrawer>
            </Presence>
          </>
        ) : (
          <>
            {outlinePanel()}
            <DocumentCanvas doc={doc} />
            {/* 样式与批注共用右侧单一辅助栏（分标签），不再同时占两列 */}
            {auxRail()}
          </>
        )}
      </div>
      <footer
        data-word-delivery-footer
        aria-label="交付操作"
        className={`flex min-w-0 shrink-0 border-t border-hairline ${
          breakpoint === "narrow"
            ? "h-14 max-w-full overflow-x-auto overflow-y-hidden"
            : "flex-wrap items-start gap-2 px-3 py-2"
        }`}
      >
        {breakpoint === "narrow" ? (
          <div className="flex h-full min-w-max flex-nowrap items-start gap-2 [&>section]:shrink-0">
            <ExportPanel />
            <QualityPanel />
            <section aria-label="打印预览入口" className="flex shrink-0 items-center border-t border-hairline bg-rail px-3 py-2">
              <button
                type="button"
                aria-label="打开打印预览"
                className="rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                onClick={() => setNarrowRail("print-preview")}
              >
                打印预览
              </button>
            </section>
          </div>
        ) : (
          <>
            <ExportPanel />
            <QualityPanel />
            <PrintPreview />
          </>
        )}
      </footer>
    </div>
  );
}
