import { createEmptyDeck, type PptDocument, type PptSlide } from "@studio/ppt-toolkit";
import { vi } from "vitest";
import { usePptEditorStore } from "./state";

/** Deck with one text + one shape object on slide-1, plus an empty slide-2. */
export function sampleDeck(): PptDocument {
  const deck = createEmptyDeck("示例演示");
  const slide: PptSlide = {
    id: "slide-1",
    title: "第一页",
    notes: "",
    objects: [
      { kind: "text", id: "text-1", rect: { x: 100, y: 80, w: 600, h: 80 }, paragraphs: [{ runs: [{ text: "标题文本" }] }], fontSize: 32 },
      { kind: "shape", id: "shape-1", rect: { x: 100, y: 200, w: 200, h: 120 }, shape: "round", fill: "#0F766E" },
    ],
  };
  const second: PptSlide = { id: "slide-2", title: "第二页", notes: "", objects: [] };
  return { ...deck, slides: [slide, second] };
}

/** Reset the store to the sample deck with a fresh change callback. */
export function resetStore() {
  const onDocumentChange = vi.fn();
  usePptEditorStore.getState().syncDocument(sampleDeck());
  usePptEditorStore.getState().setOnChange(onDocumentChange);
  return { onDocumentChange };
}
