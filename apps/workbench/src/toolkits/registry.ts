import type { ProjectMeta } from "@studio/schema-core";
import type { EditorDocument } from "../state/editorStore";
import type { ToolkitScope } from "../features/ai/types";
import type {
  PptProjectBundle,
  UiProjectBundle,
  WordProjectBundle,
} from "../api/client";
import { usePptEditorStore } from "./ppt/state";
import { useWordEditorStore } from "./word/state";

/**
 * Workbench-side toolkit registry (P7.3).
 *
 * 元数据表：每种项目类型的展示名与编辑器可用性。编辑器面板本身由
 * toolkits/ppt、toolkits/word 域的后续 PR 接入（REG 阶段只有占位面板）。
 * 这里只放"类型 → 标签/能力"的声明式映射，UI 代理据此渲染与分派。
 */

export interface ToolkitMeta {
  projectType: ProjectMeta["projectType"];
  /** 展示名（占位面板/项目类型单选等处复用）。 */
  label: string;
  /** 专属编辑器面板是否已接入（false → App 渲染占位槽位）。 */
  editorReady: boolean;
}

export const TOOLKIT_METAS: ToolkitMeta[] = [
  { projectType: "ui", label: "UI 网页", editorReady: true },
  { projectType: "ppt", label: "PPT 演示", editorReady: true },
  { projectType: "word", label: "Word 文档", editorReady: true },
];

export function toolkitLabel(projectType: ProjectMeta["projectType"]): string {
  return TOOLKIT_METAS.find((t) => t.projectType === projectType)?.label ?? projectType;
}

export function isEditorReady(projectType: ProjectMeta["projectType"]): boolean {
  return TOOLKIT_METAS.find((t) => t.projectType === projectType)?.editorReady ?? false;
}

/**
 * Bundle → 编辑器文档的类型收窄：ppt/word 编辑器面板从各自的窄化分支
 * 取文档（UI 面板继续用 UiProjectBundle）。后续 UI 代理在 contribution
 * 注册时以 projectType 为 key 找到对应分支。
 */
export function asPptBundle(bundle: { meta: ProjectMeta; document: EditorDocument }): PptProjectBundle | null {
  return bundle.meta.projectType === "ppt" ? (bundle as PptProjectBundle) : null;
}

export function asWordBundle(bundle: { meta: ProjectMeta; document: EditorDocument }): WordProjectBundle | null {
  return bundle.meta.projectType === "word" ? (bundle as WordProjectBundle) : null;
}

export function asUiBundle(bundle: { meta: ProjectMeta; document: EditorDocument }): UiProjectBundle | null {
  return bundle.meta.projectType === "ui" ? (bundle as UiProjectBundle) : null;
}

/**
 * P7.3 toolkit selection contract: map each editor store's live selection to
 * the frozen request scope { kind, targetIds } for /api/chat/completions.
 * ppt: object selection > slide selection > whole file;
 * word: block selection > (defensive) section selection > whole file.
 *
 * Stale ids are filtered here: imports (replaceDeck), undo, deletes and
 * failed partial applies can leave the store selection pointing at targets
 * the document no longer contains (live repro: a request scoped to a deleted
 * "cover-bg" died server-side with "PPT 选择目标不存在" before any command ran).
 */
export function getToolkitSelection(projectType: "ppt" | "word"): ToolkitScope {
  if (projectType === "ppt") {
    const ppt = usePptEditorStore.getState();
    // Explicit "no slide selected" (click empty canvas) means whole-file reach;
    // do NOT silently narrow it to the first slide.
    if (ppt.selectedSlideId === null) return { kind: "file", targetIds: [] };
    const slide = ppt.deck?.slides.find((candidate) => candidate.id === ppt.selectedSlideId) ?? null;
    if (slide) {
      const aliveObjects = ppt.selectedObjectIds.filter((id) =>
        slide.objects.some((object) => object.id === id),
      );
      // Stale object selection (deleted/imported away, live repro "cover-bg")
      // drops to the still-alive current slide rather than sending dead ids.
      if (aliveObjects.length > 0) return { kind: "selection", targetIds: aliveObjects };
      return { kind: "container", targetIds: [slide.id] };
    }
    // selectedSlideId points at a deleted slide (import/undo desync): fall back
    // to the first available slide; empty deck → file.
    if (ppt.deck?.slides[0]) return { kind: "container", targetIds: [ppt.deck.slides[0].id] };
    return { kind: "file", targetIds: [] };
  }
  const word = useWordEditorStore.getState();
  const candidateIds =
    word.selection.blockIds.length > 0 ? word.selection.blockIds : word.selection.blockId ? [word.selection.blockId] : [];
  const aliveBlocks = candidateIds.filter((id) => word.doc?.blocks.some((block) => block.id === id));
  if (aliveBlocks.length > 0) return { kind: "selection", targetIds: aliveBlocks };
  // No alive block: a still-valid section anchor (section click or stale block)
  // falls back to container scope rather than blowing up the whole turn.
  if (word.selection.sectionId) {
    const aliveSection = word.doc?.sections.some((section) => section.id === word.selection.sectionId);
    if (aliveSection) return { kind: "container", targetIds: [word.selection.sectionId] };
  }
  return { kind: "file", targetIds: [] };
}

/**
 * Deck/document-level intent wording (Chinese, real-model verified). These
 * requests must create nodes OUTSIDE the currently selected container — under
 * container scope slide.add is file-only and predeclared new ids fail the scope
 * gate, so the all-or-nothing batch rolls back and the run ends with streaming
 * text but a blank canvas. Hit → widen the frozen scope to file. Explicit
 * object/block selection ("selection") always wins, same as the UI modeFor
 * contract.
 */
const PPT_DECK_INTENT =
  /(?:新增|添加|加|插入|来|再来|新建|创建|生成|做|写|设计|制作|补)[^\n。；;：:]{0,8}(?:页|幻灯片|slide|封面|封底|目录)|\d+\s*(?:页|张)|(?:做|写|生成|制作|设计|创建|准备|输出|搭|起草)[^\n。；;：:]{0,24}(?:PPT|ppt|演示稿|演示|汇报|路演|课件|讲稿|幻灯|deck)|整套|整份|整篇|全篇|全套|所有页|每一?页|多页|大纲/i;

const WORD_DOC_INTENT =
  /(?:新增|添加|加|插入|来|新建|创建|生成|补|续写)[^\n。；;：:]{0,8}(?:章节|章|节|段落|段|部分|板块|小节)|\d+\s*(?:个)?(?:章节|部分|板块)|(?:写|生成|制作|做|输出|起草|准备|重新生成|重写)[^\n。；;：:]{0,24}(?:文档|报告|文章|稿|word|Word|周报|月报|简报|汇报|总结|文案)|整篇|整份|整个文档|全文|全套|大纲/i;

/**
 * Resolve the ACTUAL request scope for a chat turn: the live selection plus
 * deck/document-level intent widening. Selection scope is never widened (an
 * explicitly selected object/block is a deliberate local-edit gesture);
 * container scope widens to file on structural wording; file stays file.
 */
export function resolveToolkitRequestScope(projectType: "ppt" | "word", text: string): ToolkitScope {
  const base = getToolkitSelection(projectType);
  if (base.kind !== "container") return base;
  const deckIntent = projectType === "ppt" ? PPT_DECK_INTENT : WORD_DOC_INTENT;
  return deckIntent.test(text) ? { kind: "file", targetIds: [] } : base;
}
