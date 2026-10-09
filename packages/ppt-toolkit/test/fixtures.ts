import type { CommandInvocation, SelectionScope } from "@studio/studio-core";
import type { PptDocument, PptPlaceholderObject, PptSlide } from "../src/index.js";
import { createPptDocumentEnvelope, createSlideFromLayout } from "../src/index.js";

/** Type guard for the placeholder discriminated-union member (tests only). */
export function isPlaceholder(object: PptSlide["objects"][number]): object is PptPlaceholderObject {
  return object.kind === "placeholder";
}

/** Baseline deck: one blank slide with a text + shape object, brand theme. */
export function sampleDocument(): PptDocument {
  const deck = emptyDeck("示例演示");
  const slide: PptSlide = {
    id: "slide-1",
    title: "第一页",
    notes: "",
    objects: [
      { kind: "text", id: "text-1", rect: { x: 100, y: 80, w: 600, h: 80 }, paragraphs: [{ runs: [{ text: "标题文本" }] }], fontSize: 32 },
      { kind: "shape", id: "shape-1", rect: { x: 100, y: 200, w: 200, h: 120 }, shape: "round", fill: "#0F766E" },
    ],
  };
  return { ...deck, slides: [slide] };
}

export function emptyDeck(name: string): PptDocument {
  const created = createSlideFromLayout("blank", new Set(), `${name} 页`);
  return {
    documentVersion: 1,
    name,
    presentation: { title: null, author: null, subject: null },
    slideSize: { w: 1280, h: 720 },
    theme: {
      primary: "#0F766E",
      secondary: "#134E4A",
      accent: "#F59E0B",
      background: "#F8FAFC",
      fontTitle: "Inter, sans-serif",
      fontBody: "Inter, sans-serif",
    },
    masters: [],
    layouts: [],
    slides: [created],
  };
}

export function envelope(document: PptDocument = sampleDocument()) {
  return createPptDocumentEnvelope(document);
}

export const fileScope: SelectionScope = { kind: "file", targetIds: [] };
export const slideScope: SelectionScope = { kind: "container", targetIds: ["slide-1"] };
export const objectScope: SelectionScope = { kind: "selection", targetIds: ["text-1"] };

export function invocation(id: string, args: unknown, scope: SelectionScope = fileScope, invocationId?: string): CommandInvocation {
  return { invocationId: invocationId ?? `${id}-${Math.random().toString(36).slice(2, 8)}`, id, args, source: "manual", scope };
}
