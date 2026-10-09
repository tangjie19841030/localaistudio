import type { Block, Section, WordDocument } from "@studio/word-toolkit";
import { getBlock } from "@studio/word-toolkit";
import { useEffect, useState } from "react";
import { manualInvocation, runWordCommands, useWordEditorStore } from "./state";

/** Heading indent depth: heading1 → 1, heading2 → 2, heading3 → 3; others → 0. */
function outlineDepth(block: Block): number {
  return block.type === "heading" ? block.level : 0;
}

/** Inline text preview of a block for the outline row label. */
function blockLabel(block: Block): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.runs.map((run) => run.text).join("") || "（空段落）";
    case "list":
      return `列表（${block.items.length} 项）`;
    case "table":
      return `表格（${block.rows.length} 行）`;
    case "image":
      return "图片";
    case "pageBreak":
      return "——分页符——";
    case "tocPlaceholder":
      return "目录";
  }
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  heading: "标题",
  paragraph: "段落",
  list: "列表",
  table: "表格",
  image: "图片",
  pageBreak: "分页符",
  tocPlaceholder: "目录",
};

/** Insert-payload presets for the quick-insert menu (id assigned by the command). */
export const QUICK_BLOCK_PRESETS: { type: Block["type"]; label: string; payload: unknown }[] = [
  { type: "heading", label: "标题", payload: { type: "heading", level: 1, runs: [{ text: "新标题" }] } },
  { type: "paragraph", label: "段落", payload: { type: "paragraph", runs: [{ text: "新段落" }] } },
  { type: "list", label: "列表", payload: { type: "list", ordered: false, items: [{ runs: [{ text: "列表项" }] }] } },
  { type: "table", label: "表格", payload: { type: "table", headerRowCount: 1, rows: [
    { cells: [{ runs: [{ text: "列一" }] }, { runs: [{ text: "列二" }] }] },
    { cells: [{ runs: [{ text: "" }] }, { runs: [{ text: "" }] }] },
  ] } },
  { type: "image", label: "图片占位", payload: { type: "image", src: "placeholder", width: 200 } },
];

function insertSection(): void {
  runWordCommands([manualInvocation("word.section.insert", { heading: "新章节" })]);
}

function insertBlock(sectionId: string, payload: unknown): void {
  runWordCommands([manualInvocation("word.block.insert", { block: payload, sectionId })]);
}

function renameSection(sectionId: string, heading: string): boolean {
  return runWordCommands([manualInvocation("word.section.rename", { sectionId, heading })]);
}

/** One section group: heading row (click=select section, dbl-click rename) + blocks. */
function SectionGroup({ doc, section, selectedBlockIds, containerSelected, onSelect, nameDraft, onNameDraftChange }: {
  doc: WordDocument;
  section: Section;
  selectedBlockIds: string[];
  containerSelected: boolean;
  onSelect: (id: string) => void;
  nameDraft?: string;
  onNameDraftChange?: (draft: string | undefined) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [localName, setLocalName] = useState(section.heading ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const name = nameDraft ?? localName;

  useEffect(() => {
    if (nameDraft === undefined) setLocalName(section.heading ?? "");
  }, [section.id, section.heading, nameDraft]);

  const commitRename = () => {
    setRenaming(false);
    if (!name.trim()) {
      setLocalName(section.heading ?? "");
      onNameDraftChange?.(undefined);
      return;
    }
    if (name.trim() === section.heading) {
      setLocalName(section.heading ?? "");
      onNameDraftChange?.(undefined);
      return;
    }
    if (name.trim() !== section.heading && renameSection(section.id, name)) {
      onNameDraftChange?.(undefined);
      setLocalName(name);
    }
  };

  return (
    <li aria-label={`章节 ${section.heading ?? section.id}`}>
      <div className="group flex items-center gap-1 px-2 py-1">
        {renaming ? (
          <input
            aria-label="章节标题输入"
            className="min-w-0 flex-1 rounded-sm bg-surface px-1 text-xs text-ink outline-none ring-1 ring-hairline focus:ring-accent"
            value={name}
            onChange={(e) => {
              const value = e.target.value;
              setLocalName(value);
              onNameDraftChange?.(value);
            }}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            aria-pressed={containerSelected}
            className={`min-w-0 flex-1 truncate text-left text-xs font-semibold hover:text-ink ${
              containerSelected ? "bg-accent-soft text-ink" : "text-ink-soft"
            }`}
            onClick={() => useWordEditorStore.getState().selectSection(section.id)}
            onDoubleClick={() => {
              setLocalName(nameDraft ?? section.heading ?? "");
              setRenaming(true);
            }}
            title="单击选中整个章节（AI 只改本章），双击重命名"
          >
            {section.heading || `章节 ${section.id}`}
          </button>
        )}
        <div className="relative">
          <button
            type="button"
            aria-label={`在章节 ${section.heading ?? section.id} 新增块`}
            className="rounded-sm px-1 text-xs text-ink-muted opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ＋
          </button>
          {menuOpen && (
            <ul className="absolute right-0 top-full z-10 mt-1 flex w-24 flex-col gap-0.5 rounded-lg border border-hairline bg-overlay p-1 text-xs shadow-card">
              {/* Images are inserted via the top toolbar (real asset upload),
                  not a fake src="placeholder" block. */}
              {QUICK_BLOCK_PRESETS.filter((preset) => preset.type !== "image").map((preset) => (
                <li key={preset.type}>
                  <button
                    type="button"
                    className="w-full rounded-sm px-2 py-1 text-left text-ink hover:bg-surface"
                    onClick={() => {
                      setMenuOpen(false);
                      insertBlock(section.id, preset.payload);
                    }}
                  >
                    {preset.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-0.5 pb-1">
        {section.blockIds.map((blockId) => {
          const block = getBlock(doc, blockId);
          if (!block) return null;
          const depth = outlineDepth(block);
          const selected = selectedBlockIds.includes(blockId);
          return (
            <li key={blockId}>
              <button
                type="button"
                aria-label={`大纲块 ${blockLabel(block)}`}
                aria-pressed={selected}
                className={`flex w-full items-center gap-1 truncate rounded-sm px-2 py-0.5 text-left text-xs ${
                  selected ? "bg-accent-soft text-ink" : "text-ink-muted hover:bg-surface hover:text-ink-soft"
                }`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onClick={(e) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) useWordEditorStore.getState().toggleBlock(blockId);
                  else onSelect(blockId);
                }}
              >
                <span className="shrink-0 text-[10px] text-ink-faint">{BLOCK_TYPE_LABELS[block.type] ?? block.type}</span>
                <span className="truncate">{blockLabel(block)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Left outline tree: sections and their blocks, indented by heading level. */
export function OutlinePanel({ doc, onSelectBlock, embedded = false, sectionNameDrafts, onSectionNameDraftChange }: {
  doc: WordDocument;
  onSelectBlock: (id: string) => void;
  sectionNameDrafts?: Record<string, string>;
  onSectionNameDraftChange?: (sectionId: string, draft: string | undefined) => void;
  /** Remove desktop rail sizing when the outline is hosted in a drawer. */
  embedded?: boolean;
}) {
  const selection = useWordEditorStore((s) => s.selection);
  return (
    <aside
      aria-label="文档大纲"
      className={embedded
        ? "flex min-h-0 min-w-0 w-full flex-1 flex-col border-r border-hairline bg-surface"
        : "flex h-full w-56 shrink-0 flex-col border-r border-hairline bg-surface"}
    >
      <header className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-ink-soft">
        大纲
        <button
          type="button"
          aria-label="新增章节"
          className="rounded-sm px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface hover:text-ink"
          onClick={insertSection}
        >
          ＋ 章节new
        </button>
      </header>
      <ul className="flex-1 overflow-y-auto px-1 py-1">
        {doc.sections.map((section) => (
          <SectionGroup
            key={section.id}
            doc={doc}
            section={section}
            selectedBlockIds={selection.blockIds.length > 0 ? selection.blockIds : selection.blockId ? [selection.blockId] : []}
            containerSelected={selection.blockIds.length === 0 && !selection.blockId && selection.sectionId === section.id}
            onSelect={onSelectBlock}
            nameDraft={sectionNameDrafts?.[section.id]}
            onNameDraftChange={(draft) => onSectionNameDraftChange?.(section.id, draft)}
          />
        ))}
      </ul>
    </aside>
  );
}
