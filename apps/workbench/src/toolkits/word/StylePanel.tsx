import type { Block, Run, WordDocument, WordStyleId } from "@studio/word-toolkit";
import { deriveResolvedBlockStyle, getBlock, WORD_STYLE_IDS } from "@studio/word-toolkit";
import { useRef, useState } from "react";

const EMPTY_IDS: readonly string[] = [];
import { api } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import { manualInvocation, runWordCommands, useWordEditorStore } from "./state";

const STYLE_LABELS: Record<WordStyleId, string> = {
  normal: "正文",
  title: "标题页",
  heading1: "一级标题",
  heading2: "二级标题",
  heading3: "三级标题",
  caption: "图注",
  quote: "引用",
};

function setStyle(blockId: string, styleId: string): void {
  // Empty string clears the paragraph styleId (set-style command contract).
  runWordCommands([manualInvocation("word.block.set-style", { blockId, ...(styleId ? { styleId: styleId as WordStyleId } : { clearStyle: true }) })]);
}

/** Read-only summary of the finally resolved block style (font/size/spacing). */
function StyleSummary({ doc, blockId }: { doc: WordDocument; blockId: string }) {
  const block = getBlock(doc, blockId);
  if (!block) return null;
  const resolved = deriveResolvedBlockStyle(doc.styles, block);
  const declared = block.type === "paragraph" ? block.styleId : undefined;
  return (
    <dl aria-label={`样式摘要 ${blockId}`} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-muted">
      <dt>块类型</dt>
      <dd className="text-ink-soft">{block.type}</dd>
      <dt>字号</dt>
      <dd className="text-ink-soft">{resolved.size}pt</dd>
      <dt>段前/段后</dt>
      <dd className="text-ink-soft">{resolved.spaceBefore}pt / {resolved.spaceAfter}pt</dd>
      <dt>加粗/斜体</dt>
      <dd className="text-ink-soft">{resolved.bold ? "是" : "否"} / {resolved.italic ? "是" : "否"}</dd>
      <dt>当前 styleId</dt>
      <dd className="text-ink-soft">{declared ?? "（继承）"}</dd>
    </dl>
  );
}

/** Direct run formatting for heading/paragraph/list (bold/italic/underline/color/size). */
function RunFormatBar({ block }: { block: Extract<Block, { runs: Run[] }> | Extract<Block, { type: "list" }> }) {
  const runsOf = (): Run[][] => {
    if (block.type === "list") return block.items.map((item) => item.runs);
    return [block.runs];
  };
  const allRuns = runsOf().flat();
  const all = (key: "bold" | "italic" | "underline") => allRuns.length > 0 && allRuns.every((r) => r[key] === true);
  const commonColor = allRuns[0]?.color ?? "#000000";
  const commonSize = allRuns[0]?.size ?? "";

  const patchRuns = (mut: (run: Run) => void) => {
    if (block.type === "list") {
      const items = block.items.map((item) => ({ runs: item.runs.map((r) => { const n = { ...r }; mut(n); return n; }) }));
      runWordCommands([manualInvocation("word.list.update", { blockId: block.id, items })]);
      return;
    }
    const runs = block.runs.map((r) => { const n = { ...r }; mut(n); return n; });
    runWordCommands([manualInvocation("word.block.update-text", { blockId: block.id, runs })]);
  };
  const toggle = (key: "bold" | "italic" | "underline") => {
    const next = !all(key);
    patchRuns((r) => {
      r[key] = next;
      if (!next) delete r[key];
    });
  };
  const btn = (label: string, key: "bold" | "italic" | "underline", extraClass = "") => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={all(key)}
      className={`h-7 w-8 rounded-md border text-xs ${all(key) ? "border-accent bg-accent-soft text-accent" : "border-hairline bg-overlay text-ink-soft"} ${extraClass}`}
      onClick={() => toggle(key)}
    >
      {key === "bold" ? "B" : key === "italic" ? "I" : "U"}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1">
      {btn("加粗", "bold", "font-bold")}
      {btn("斜体", "italic", "italic")}
      {btn("下划线", "underline", "underline")}
      <label className="flex items-center gap-1 text-[10px] text-ink-muted" title="文字颜色">
        <input
          type="color"
          aria-label="文字颜色"
          value={commonColor}
          onChange={(e) => patchRuns((r) => { r.color = e.target.value; })}
          className="h-7 w-9 cursor-pointer rounded border border-hairline bg-overlay"
        />
      </label>
      <input
        type="number"
        aria-label="字号（pt）"
        min={6}
        max={96}
        placeholder="字号"
        defaultValue={commonSize}
        className="h-7 w-16 rounded-md border border-hairline bg-overlay px-1.5 text-xs text-ink"
        onBlur={(e) => {
          const size = Number(e.target.value);
          if (Number.isFinite(size) && size >= 6 && size <= 96) patchRuns((r) => { r.size = size; });
          e.target.value = String(runsOf().flat()[0]?.size ?? "");
        }}
      />
    </div>
  );
}

/** Image block: upload a project asset as src, set width/caption (AI sees asset). */
function ImageBlockFields({ blockId, block }: { blockId: string; block: Extract<NonNullable<ReturnType<typeof getBlock>>, { type: "image" }> }) {
  const projectId = useEditorStore((s) => s.projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState(block.caption ?? "");

  const upload = async (file: File | undefined) => {
    if (!file || !projectId) return;
    setBusy(true);
    try {
      const uploaded = await api.uploadPptAsset(projectId, file);
      runWordCommands([manualInvocation("word.block.update-image", { blockId, src: uploaded.src })]);
    } catch {
      // network/parse errors surface in the toolbar error strip
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <button
        type="button"
        className="rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-ink disabled:opacity-50"
        disabled={busy || !projectId}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "上传中…" : "上传图片替换"}
      </button>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        宽度（pt）
        <input
          type="number"
          min={1}
          defaultValue={block.width}
          className="rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-ink"
          onBlur={(e) => {
            const width = Number(e.target.value);
            if (Number.isFinite(width) && width > 0) {
              runWordCommands([manualInvocation("word.block.update-image", { blockId, width })]);
            }
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        图注
        <input
          className="rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-ink"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => {
            if (caption !== (block.caption ?? "")) {
              runWordCommands([
                manualInvocation("word.block.update-image", {
                  blockId,
                  caption: caption.trim() === "" ? null : caption,
                }),
              ]);
            }
          }}
        />
      </label>
    </div>
  );
}

/** Multi-selection batch actions: lock/delete all, apply bold to all text blocks. */
function MultiSelectSection({ doc, ids }: { doc: WordDocument; ids: string[] }) {
  const blocks = ids.map((id) => getBlock(doc, id)).filter((b): b is Block => Boolean(b));
  const batch = (commandId: string, argsFor: (id: string) => unknown) =>
    runWordCommands(blocks.filter((b) => !b.locked).map((b) => manualInvocation(commandId, argsFor(b.id))));
  const allLocked = blocks.length > 0 && blocks.every((b) => b.locked === true);
  const boldAll = () => {
    const invocations = blocks.flatMap((b) => {
      if (b.type === "paragraph" || b.type === "heading") {
        return [manualInvocation("word.block.update-text", { blockId: b.id, runs: b.runs.map((r) => ({ ...r, bold: true })) })];
      }
      if (b.type === "list") {
        return [manualInvocation("word.list.update", { blockId: b.id, items: b.items.map((i) => ({ runs: i.runs.map((r) => ({ ...r, bold: true })) })) })];
      }
      return [];
    });
    if (invocations.length > 0) runWordCommands(invocations);
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-soft">已选 {blocks.length} 个块</p>
      <button type="button" className="rounded-md border border-hairline bg-overlay px-2 py-1 text-xs" onClick={boldAll}>
        全部加粗
      </button>
      <div className="flex gap-1">
        <button
          type="button"
          className="flex-1 rounded-md border border-hairline bg-overlay px-2 py-1 text-xs"
          onClick={() => batch("word.block.set-locked", (id) => ({ blockId: id, locked: !allLocked }))}
        >
          {allLocked ? "全部解锁" : "全部锁定"}
        </button>
        <button
          type="button"
          className="flex-1 rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-danger"
          onClick={() => batch("word.block.remove", (id) => ({ blockId: id }))}
        >
          全部删除
        </button>
      </div>
    </div>
  );
}

/** Style tab body (WordAuxRail owns the rail chrome): style picker + summary. */
export function StylePanel({ doc }: { doc: WordDocument }) {
  // Select stable refs (a selector returning a fresh [] loops useSyncExternalStore).
  const multiIds = useWordEditorStore((s) => s.selection.blockIds);
  const primaryId = useWordEditorStore((s) => s.selection.blockId);
  const selectedIds = multiIds.length > 0 ? multiIds : primaryId ? [primaryId] : EMPTY_IDS;
  const multi = selectedIds.length > 1;
  const selectedBlockId = selectedIds[0] ?? null;
  const selectedBlock = selectedBlockId ? getBlock(doc, selectedBlockId) : undefined;
  const isParagraph = selectedBlock?.type === "paragraph";

  return (
    <section aria-label="样式面板" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <h2 className="text-xs font-semibold text-ink-soft">样式</h2>
      {multi ? (
        <MultiSelectSection doc={doc} ids={[...selectedIds]} />
      ) : !selectedBlock ? (
        <p className="text-xs text-ink-muted">选中一个块后可设置段落样式。</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            段落样式
            <select
              aria-label="块样式选择"
              className="rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-ink"
              disabled={!isParagraph}
              value={selectedBlock.type === "paragraph" ? selectedBlock.styleId ?? "" : ""}
              onChange={(e) => setStyle(selectedBlock.id, e.target.value)}
            >
              <option value="">（正文/继承）</option>
              {WORD_STYLE_IDS.filter((id) => id !== "normal").map((id) => (
                <option key={id} value={id}>
                  {STYLE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          {!isParagraph && selectedBlock.type !== "image" && selectedBlock.type !== "heading" && (
            <p className="text-[10px] text-ink-faint">仅段落块支持设置段落样式；标题/图注等使用隐式样式。</p>
          )}
          {(selectedBlock.type === "heading" ||
            selectedBlock.type === "paragraph" ||
            selectedBlock.type === "list") && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">字符格式</span>
              <RunFormatBar block={selectedBlock} />
            </div>
          )}
          {selectedBlock.type === "heading" && (
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              标题层级
              <select
                aria-label="标题层级"
                className="rounded-md border border-hairline bg-overlay px-2 py-1 text-xs text-ink"
                value={selectedBlock.level}
                onChange={(e) =>
                  runWordCommands([
                    manualInvocation("word.heading.set-level", {
                      blockId: selectedBlock.id,
                      level: Number(e.target.value),
                    }),
                  ])
                }
              >
                <option value={1}>一级标题</option>
                <option value={2}>二级标题</option>
                <option value={3}>三级标题</option>
              </select>
            </label>
          )}
          {selectedBlock.type === "image" && <ImageBlockFields blockId={selectedBlock.id} block={selectedBlock} />}
          <StyleSummary doc={doc} blockId={selectedBlock.id} />
        </>
      )}
    </section>
  );
}
