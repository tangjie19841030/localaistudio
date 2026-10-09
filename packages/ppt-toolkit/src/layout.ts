import { SLIDE_HEIGHT, SLIDE_WIDTH, type PptDocument, type PptPlaceholderObject, type PptSlide } from "./document.js";
import { defaultTheme } from "./theme.js";

export const PPT_LAYOUT_IDS = ["title", "titleContent", "blank"] as const;
export type PptLayoutId = (typeof PPT_LAYOUT_IDS)[number];

interface PlaceholderSpec {
  subtype: PptPlaceholderObject["subtype"];
  rect: { x: number; y: number; w: number; h: number };
  text?: string;
}

/**
 * Fixed-canvas geometry presets (1280x720). Geometry is stored per slide
 * object (no live master system in P9.1), so templates stamp concrete
 * placeholders rather than inheritable frames.
 */
const LAYOUT_SPECS: Record<PptLayoutId, PlaceholderSpec[]> = {
  title: [
    { subtype: "title", rect: { x: 140, y: 240, w: 1000, h: 140 }, text: "标题" },
    { subtype: "subtitle", rect: { x: 140, y: 420, w: 1000, h: 80 }, text: "副标题" },
  ],
  titleContent: [
    { subtype: "title", rect: { x: 80, y: 60, w: 1120, h: 100 }, text: "标题" },
    { subtype: "content", rect: { x: 80, y: 200, w: 1120, h: 460 }, text: "内容" },
  ],
  blank: [],
};

export function makeSlideId(seed: string, taken: ReadonlySet<string>): string {
  let n = 1;
  let candidate = `${seed}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${seed}-${n}`;
  }
  return candidate;
}

function makeObjectId(slideId: string, subtype: string, taken: ReadonlySet<string>): string {
  let n = 1;
  let candidate = `${slideId}-${subtype}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${slideId}-${subtype}-${n}`;
  }
  return candidate;
}

/** Create an empty slide with sensible defaults (no placeholders). */
export function createSlide(id: string, title: string): PptSlide {
  return { id, title, notes: "", objects: [] };
}

/**
 * Apply a built-in layout to a slide. PowerPoint semantics: the layout REPLACES
 * the slide's placeholder set (old placeholders are not scaffolding to stack up)
 * while non-placeholder objects (user content) are kept. When a previous
 * placeholder of the same subtype exists, its text carries over so
 * re-applying a layout doesn't wipe a typed title.
 */
export function applyLayoutTemplate(slide: PptSlide, layoutId: PptLayoutId): PptSlide {
  const specs = LAYOUT_SPECS[layoutId];
  const previousBySubtype = new Map(
    slide.objects.filter((object) => object.kind === "placeholder").map((object) => [object.subtype, object]),
  );
  const kept = slide.objects.filter((object) => object.kind !== "placeholder");
  const taken = new Set(kept.map((object) => object.id));
  const placeholders: PptPlaceholderObject[] = specs.map((spec) => {
    const id = makeObjectId(slide.id, spec.subtype, taken);
    taken.add(id);
    const previous = previousBySubtype.get(spec.subtype);
    // User text on an existing same-subtype placeholder wins over the spec default.
    const text = previous?.text ?? spec.text;
    return {
      kind: "placeholder",
      id,
      rect: spec.rect,
      subtype: spec.subtype,
      ...(text !== undefined ? { text } : {}),
    };
  });
  return { ...slide, layoutId, objects: [...kept, ...placeholders] };
}

/** Create a new slide pre-populated from a layout template. */
export function createSlideFromLayout(
  layoutId: PptLayoutId,
  takenIds: ReadonlySet<string>,
  title?: string,
): PptSlide {
  const id = makeSlideId("slide", takenIds);
  const base = createSlide(id, title ?? layoutTitle(layoutId));
  return applyLayoutTemplate(base, layoutId);
}

function layoutTitle(layoutId: PptLayoutId): string {
  if (layoutId === "title") return "标题页";
  if (layoutId === "titleContent") return "内容页";
  return "空白页";
}

/** Blank deck: one title slide, default theme, fixed 16:9 canvas. */
export function createEmptyDeck(name: string): PptDocument {
  const slide = createSlideFromLayout("title", new Set(), "幻灯片 1");
  return {
    documentVersion: 1,
    name,
    presentation: { title: null, author: null, subject: null },
    slideSize: { w: SLIDE_WIDTH, h: SLIDE_HEIGHT },
    theme: defaultTheme(),
    masters: [],
    layouts: [],
    slides: [slide],
  };
}

export function isLayoutId(value: string): value is PptLayoutId {
  return (PPT_LAYOUT_IDS as readonly string[]).includes(value);
}
