import type { DocumentEnvelope, SelectionScope, ToolKit } from "@studio/studio-core";
import type { ChatMessage } from "./provider.js";

/**
 * Deterministic mock drivers for toolkit projects (ppt/word). Mirrors the UI
 * mock driver's contract: one scripted batch, then finished. Scripts branch on
 * the resolved SelectionScope so the offline default provider demonstrates the
 * scoped AI flow end to end (server-side pre-execution included).
 */

export interface ToolkitCall {
  commandId: string;
  args: unknown;
}

export interface ToolkitDriverInput {
  messages: ChatMessage[];
  scope: SelectionScope;
  /** Current domain document (toolkit-typed on the caller side). */
  doc?: unknown;
  /** Scratch envelope for SDK-style drivers that self-execute. */
  envelope: DocumentEnvelope;
  signal?: AbortSignal;
}

export interface ToolkitStep {
  commandId: string;
  ok: boolean;
  message: string;
  invocationId?: string;
  args?: unknown;
}

export interface ToolkitInternalState {
  steps: ToolkitStep[];
  envelope: DocumentEnvelope;
  /** Unrecoverable mid-round failure (e.g. the scope target vanished); the loop aborts. */
  fatal?: string;
  /** Effective scope after mid-round healing; terminal frames reuse it. */
  scope?: SelectionScope;
}

export interface ToolkitDriver {
  /** Propose the next batch of commands; empty = done. */
  next(input: ToolkitDriverInput): Promise<ToolkitCall[]>;
  /** SDK-style drivers stash executed steps + the advanced envelope here. */
  takeInternal?: () => ToolkitInternalState | undefined;
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") return messages[i]!.content;
  }
  return "";
}

function instructionNote(messages: ChatMessage[]): string {
  const text = lastUserText(messages).replace(/[\r\n]+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || "按指令调整";
}

function targetIdsOf(scope: ToolkitDriverInput["scope"], fallback: string[]): string[] {
  return scope.targetIds.length > 0 ? [...scope.targetIds] : fallback;
}

/** PPT scripts: container → per-slide rename+notes; selection → per-object text; file → add+notes. */
export function pptToolkitScript(
  toolkit: ToolKit,
  scope: ToolkitDriverInput["scope"],
  messages: ChatMessage[],
  doc: unknown,
): ToolkitCall[] {
  const note = instructionNote(messages);
  if (scope.kind === "container") {
    const calls: ToolkitCall[] = [];
    for (const slideId of targetIdsOf(scope, [])) {
      calls.push({ commandId: "slide.rename", args: { slideId, title: `已优化（${note}）` } });
      calls.push({ commandId: "slide.setNotes", args: { slideId, notes: `AI 备注：${note}` } });
    }
    return calls;
  }
  if (scope.kind === "selection") {
    // editText is only valid for text-bearing objects; other kinds get skipped
    // here and the capability gate + command guard report anything unresolved.
    return targetIdsOf(scope, []).map((objectId) => ({
      commandId: "object.editText",
      args: { objectId, paragraphs: [{ runs: [{ text: `（AI 已调整）${note}` }] }] },
    }));
  }
  // file scope (storyline): add a slide and annotate the first existing one.
  const firstSlideId = (doc as { slides?: { id: string }[] } | null)?.slides?.[0]?.id;
  const calls: ToolkitCall[] = [{ commandId: "slide.add", args: {} }];
  if (firstSlideId) {
    calls.push({ commandId: "slide.setNotes", args: { slideId: firstSlideId, notes: `AI 备注：${note}` } });
  }
  void toolkit;
  return calls;
}

/** Word scripts: selection → per-block rewrite; container → section-level; file → new section. */
export function wordToolkitScript(
  scope: ToolkitDriverInput["scope"],
  messages: ChatMessage[],
): ToolkitCall[] {
  const note = instructionNote(messages);
  if (scope.kind === "selection" && scope.targetIds.length > 0) {
    return scope.targetIds.map((blockId) => ({
      commandId: "word.block.update-text",
      args: { blockId, runs: [{ text: `（AI 润色）${note}` }] },
    }));
  }
  // Container targets are SECTION ids: update-text against them is
  // "块不存在". A restructure-level section rename is valid for that reach.
  if (scope.kind === "container" && scope.targetIds.length > 0) {
    return scope.targetIds.map((sectionId) => ({
      commandId: "word.section.rename",
      args: { sectionId, heading: `已优化（${note}）`.slice(0, 120) },
    }));
  }
  return [
    { commandId: "word.section.insert", args: { heading: `AI 新章节（${note}）` } },
  ];
}

/**
 * Build the scoped mock driver. Command ids are gated by the caller against the
 * aiTools allowed for the scope kind; unknown/mismatched ids are dropped there.
 */
export function createMockToolkitDriver(
  toolkit: ToolKit,
  scope: ToolkitDriverInput["scope"],
  messages: ChatMessage[],
  doc: unknown,
): ToolkitDriver {
  let round = 0;
  const script = (): ToolkitCall[] =>
    toolkit.projectType === "ppt"
      ? pptToolkitScript(toolkit, scope, messages, doc)
      : wordToolkitScript(scope, messages);
  return {
    async next() {
      round += 1;
      return round === 1 ? script() : [];
    },
  };
}
