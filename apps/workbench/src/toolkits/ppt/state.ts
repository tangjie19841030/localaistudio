import { createPptDocumentEnvelope, PPT_TOOLKIT, type PptDocument } from "@studio/ppt-toolkit";
import { executeTransaction, type CommandInvocation } from "@studio/studio-core";
import { create } from "zustand";
import { useAiStore } from "../../state/aiStore";
import { toolkitInvocation, type ToolkitCommand, type ToolkitScope } from "../../features/ai/types";
import { repairDeckWashLayering } from "./layering";

/** Deep caps mirror the UI editor undo stack (state/undoStack.ts MAX_DEPTH=50). */
const MAX_HISTORY = 50;

let invocationSeq = 0;

/** Monotonic invocation ids keep transactions unique across the session. */
export function nextInvocationId(prefix: string): string {
  invocationSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${invocationSeq}`;
}

/** Manual-source file-scope invocation helper (P9.1 panel edits). */
export function manualInvocation(id: string, args: unknown): CommandInvocation {
  return { invocationId: nextInvocationId(id), id, args, source: "manual", scope: { kind: "file", targetIds: [] } };
}

/** Local PPT editor state: deck snapshot + selection + bounded undo history. */
export interface PptEditorState {
  /** Mirror of editorStore.document narrowed to PptDocument (null before sync). */
  deck: PptDocument | null;
  /** Envelope kept in sync with deck — executeTransaction consumes envelopes. */
  envelopeDeck: PptDocument | null;
  selectedSlideId: string | null;
  /** Objects selected on the current slide (single-slide rule, selection.ts). */
  selectedObjectIds: string[];
  error: string | null;
  past: PptDocument[];
  future: PptDocument[];
  /**
   * Drag-gesture snapshot. While set, runGesturePreview applies commands
   * against this base WITHOUT pushing history; commitGesture stamps exactly
   * one undo point for the whole pointer drag (instead of dozens per frame).
   */
  gestureBase: PptDocument | null;
  /** App wiring: writes the new deck into editorStore + marks dirty. */
  onDocumentChange: ((deck: PptDocument) => void) | null;
  /** Human-readable lines from the last load-time self-heal (for a notice). */
  lastRepairs: string[];
  /** Sync incoming document from App props (open/switch/reset); clears history. */
  syncDocument: (deck: PptDocument) => void;
  /**
   * Replace the WHOLE deck (pptx import). Unlike syncDocument this pushes an
   * undo point; selection survives when its ids still exist. The validated
   * parse output is passed as the SAME reference to onDocumentChange so the
   * later PUT save round-trips byte-identically and does not clear history.
   */
  replaceDeck: (deck: PptDocument) => boolean;
  setOnChange: (cb: (deck: PptDocument) => void) => void;
  setDocumentName: (name: string) => PptDocument | null;
  selectSlide: (id: string | null) => void;
  selectObjects: (ids: string[]) => void;
  /**
   * Toggle one object in the selection (Shift/Ctrl+click). Objects on another
   * slide REPLACE the selection — PPT selection scope is single-slide by
   * contract (selection.ts rejects cross-slide object selections).
   */
  toggleObjectSelection: (id: string) => void;
  /**
   * Run a manual transaction. On success: deck updates, history pushes,
   * onDocumentChange fires. On failure: error surfaces in Chinese, no state change.
   */
  runCommands: (invocations: readonly CommandInvocation[]) => boolean;
  /** Open a drag gesture: later previews replay from this same deck snapshot. */
  beginGesture: () => void;
  /** Apply against the gesture base with TOTAL (not incremental) deltas; no history push. */
  runGesturePreview: (invocations: readonly CommandInvocation[]) => boolean;
  /** Stamp one undo point for the gesture; keeps the final previewed deck. */
  commitGesture: () => void;
  /** Internal: adopt a new deck, optionally pushing one history entry. */
  commitDeck: (nextDeck: PptDocument, pushBase: PptDocument | null) => void;
  /** Abort a gesture and restore the deck captured at beginGesture. */
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  clearError: () => void;
}

/** Re-anchor slide/object selection onto the (possibly reordered) next deck. */
function adoptSelection(nextDeck: PptDocument, selectedSlideId: string | null, selectedObjectIds: string[]) {
  const keptSlideId = keepSlides(nextDeck, selectedSlideId ? [selectedSlideId] : [])[0] ?? nextDeck.slides[0]?.id ?? null;
  return {
    selectedSlideId: keptSlideId,
    selectedObjectIds: keepObjects(nextDeck, keptSlideId, selectedObjectIds),
  };
}

const baseState = {
  deck: null,
  envelopeDeck: null,
  selectedSlideId: null,
  selectedObjectIds: [],
  error: null,
  past: [] as PptDocument[],
  future: [] as PptDocument[],
  gestureBase: null as PptDocument | null,
  onDocumentChange: null as ((deck: PptDocument) => void) | null,
  lastRepairs: [] as string[],
};

/** Keep selection pointing at ids that still exist (post-undo/reorder). */
function keepSlides(deck: PptDocument, ids: readonly string[]): string[] {
  const known = new Set(deck.slides.map((slide) => slide.id));
  return ids.filter((id) => known.has(id));
}

function keepObjects(deck: PptDocument, slideId: string | null, ids: readonly string[]): string[] {
  const slide = deck.slides.find((candidate) => candidate.id === slideId);
  if (!slide) return [];
  const known = new Set(slide.objects.map((object) => object.id));
  return ids.filter((id) => known.has(id));
}

export const usePptEditorStore = create<PptEditorState>()((set, get) => ({
  ...baseState,

  syncDocument(deck) {
    if (get().envelopeDeck === deck) return; // same reference: nothing new
    // One-shot self-heal: old importers left pale full-bleed washes ABOVE the
    // content they were meant to sit behind. Idempotent (no-op once fixed).
    const { deck: healed, repairs } = repairDeckWashLayering(deck);
    if (repairs.length > 0) {
      // Persist the repaired order immediately (marks the project dirty).
      get().onDocumentChange?.(healed);
    }
    set({
      ...baseState,
      onDocumentChange: get().onDocumentChange,
      deck: healed,
      envelopeDeck: healed,
      selectedSlideId: healed.slides[0]?.id ?? null,
      lastRepairs: repairs,
    });
  },

  setOnChange(cb) {
    set({ onDocumentChange: cb });
  },

  replaceDeck(nextRaw) {
    const { deck, envelopeDeck } = get();
    if (!deck || !envelopeDeck) return false;
    let next: PptDocument;
    try {
      // Authoritative validation: imported/merged decks still go through zod
      // + checkPptDocument before they ever touch the editor.
      next = createPptDocumentEnvelope(nextRaw).document;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    // Idempotent layer self-heal (no-op for correctly ordered decks).
    const repaired = repairDeckWashLayering(next);
    next = repaired.deck;
    const keptSlideId = keepSlides(next, [get().selectedSlideId ?? ""])[0] ?? next.slides[0]?.id ?? null;
    set({
      deck: next,
      envelopeDeck: next,
      past: [...get().past, envelopeDeck].slice(-MAX_HISTORY),
      future: [],
      error: null,
      selectedSlideId: keptSlideId,
      selectedObjectIds: keepObjects(next, keptSlideId, get().selectedObjectIds),
    });
    get().onDocumentChange?.(next);
    return true;
  },

  setDocumentName(name) {
    const { deck, past } = get();
    if (!deck) return null;
    if (deck.name === name) return deck;
    const nextDeck = { ...deck, name };
    set({
      deck: nextDeck,
      envelopeDeck: nextDeck,
      past: [...past, deck].slice(-MAX_HISTORY),
      future: [],
      error: null,
    });
    get().onDocumentChange?.(nextDeck);
    return nextDeck;
  },

  selectSlide(id) {
    set({ selectedSlideId: id, selectedObjectIds: [] });
  },

  selectObjects(ids) {
    set({ selectedObjectIds: [...new Set(ids)] });
  },

  toggleObjectSelection(id) {
    const { deck, selectedSlideId, selectedObjectIds } = get();
    if (!deck) return;
    const ownerSlide = deck.slides.find((slide) => slide.objects.some((object) => object.id === id));
    if (!ownerSlide) return;
    // Cross-slide click replaces the selection (single-slide selection rule).
    if (ownerSlide.id !== selectedSlideId) {
      set({ selectedSlideId: ownerSlide.id, selectedObjectIds: [id] });
      return;
    }
    if (selectedObjectIds.includes(id)) {
      set({ selectedObjectIds: selectedObjectIds.filter((existing) => existing !== id) });
    } else {
      set({ selectedObjectIds: [...selectedObjectIds, id] });
    }
  },

  runCommands(invocations) {
    const { envelopeDeck } = get();
    if (!envelopeDeck) return false;
    const envelope = createPptDocumentEnvelope(envelopeDeck);
    const result = executeTransaction(PPT_TOOLKIT, envelope, invocations);
    if (!result.ok) {
      set({ error: result.error.message });
      return false;
    }
    get().commitDeck(result.envelope.document, envelopeDeck);
    return true;
  },

  beginGesture() {
    const { deck, gestureBase } = get();
    if (!deck) return;
    // Nested begin (e.g. second pointerdown without an up) keeps the ORIGINAL base.
    if (!gestureBase) set({ gestureBase: deck });
  },

  runGesturePreview(invocations) {
    const { gestureBase } = get();
    if (!gestureBase) return false;
    // Always replay from the gesture-start deck with TOTAL pointer deltas —
    // feeding each frame's delta onto the previous frame's rect was the
    // "object accelerates off the canvas" bug.
    const envelope = createPptDocumentEnvelope(gestureBase);
    const result = executeTransaction(PPT_TOOLKIT, envelope, invocations);
    if (!result.ok) return false; // a frame-level reject (lock/clamp edge) just freezes the preview
    get().commitDeck(result.envelope.document, null);
    return true;
  },

  commitGesture() {
    const { deck, gestureBase, past } = get();
    if (!gestureBase || !deck) {
      if (gestureBase) set({ gestureBase: null });
      return;
    }
    if (deck !== gestureBase) {
      set({
        gestureBase: null,
        past: [...past, gestureBase].slice(-MAX_HISTORY),
        future: [],
      });
      get().onDocumentChange?.(deck);
    } else {
      // A press without movement changes nothing: no undo point, no dirty flag.
      set({ gestureBase: null });
    }
  },

  cancelGesture() {
    const { gestureBase } = get();
    if (!gestureBase) return;
    get().commitDeck(gestureBase, null);
    set({ gestureBase: null });
  },

  /**
   * Adopt a transaction result. pushBase !== null pushes one undo point
   * (normal commands); gestures pass null and manage the stack at commit.
   */
  commitDeck(nextDeck, pushBase) {
    const { past, selectedSlideId, selectedObjectIds } = get();
    const selection = adoptSelection(nextDeck, selectedSlideId, selectedObjectIds);
    set({
      deck: nextDeck,
      envelopeDeck: nextDeck,
      error: null,
      ...(pushBase ? { past: [...past, pushBase].slice(-MAX_HISTORY), future: [] } : {}),
      ...selection,
    });
    get().onDocumentChange?.(nextDeck);
  },

  undo() {
    const { deck, past } = get();
    if (!deck || past.length === 0) return;
    const previous = past[past.length - 1]!;
    set({
      deck: previous,
      envelopeDeck: previous,
      past: past.slice(0, -1),
      future: [deck, ...get().future].slice(0, MAX_HISTORY),
      error: null,
      selectedSlideId: keepSlides(previous, [get().selectedSlideId ?? ""])[0] ?? previous.slides[0]?.id ?? null,
      selectedObjectIds: keepObjects(previous, get().selectedSlideId, get().selectedObjectIds),
    });
    get().onDocumentChange?.(previous);
  },

  redo() {
    const { deck, future } = get();
    if (!deck || future.length === 0) return;
    const nextDeck = future[0]!;
    set({
      deck: nextDeck,
      envelopeDeck: nextDeck,
      past: [...get().past, deck].slice(-MAX_HISTORY),
      future: future.slice(1),
      error: null,
      selectedSlideId: keepSlides(nextDeck, [get().selectedSlideId ?? ""])[0] ?? nextDeck.slides[0]?.id ?? null,
      selectedObjectIds: keepObjects(nextDeck, get().selectedSlideId, get().selectedObjectIds),
    });
    get().onDocumentChange?.(nextDeck);
  },

  clearError() {
    set({ error: null });
  },
}));

/** Command helper bound to the store (components call this, not runCommands). */
export function runPptCommands(invocations: readonly CommandInvocation[]): boolean {
  return usePptEditorStore.getState().runCommands(invocations);
}

/**
 * P7.3 AI applier (registered in App via aiStore.setCommandApplier): replay the
 * done-frame commands — pre-executed on the server's scratch envelope — on the
 * local deck in one atomic transaction. Scope comes from the pending plan, i.e.
 * the exact request scope the server ran the commands under. Partial batches
 * pass their request scope explicitly (the pending plan does not exist yet).
 */
export async function applyPptAiCommands(
  commands: readonly ToolkitCommand[],
  scopeOverride?: ToolkitScope,
): Promise<boolean> {
  const scope = scopeOverride ?? useAiStore.getState().pendingPlan?.scope;
  if (!scope) return false;
  return usePptEditorStore.getState().runCommands(commands.map((c) => toolkitInvocation(c, scope)));
}
