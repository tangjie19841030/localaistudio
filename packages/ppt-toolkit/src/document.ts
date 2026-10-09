import { z } from "zod";

export const PPT_DOCUMENT_VERSION = 1;

/**
 * Coordinate system: PPT uses a FIXED slide canvas (px 1280x720, origin at
 * top-left), not the unbounded free-canvas Frame semantics of the UI toolkit.
 * 1280x720 == 16:9 at a 96-DPI authoring scale; PPTX export (P9.2) converts
 * px to EMU with px * 9525. Choosing px up front keeps domain math integer
 * friendly and testable without EMU round-tripping.
 */
export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "必须是 6 位十六进制颜色，例如 #0F766E");
const objectId = z.string().min(1).max(80);
const fontStack = z.string().min(1).max(200);

/** Geometry inside the fixed slide canvas: non-negative and within bounds. */
export const rectSchema = z
  .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
  .strict()
  .superRefine((rect, ctx) => {
    if (rect.w <= 0 || rect.h <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "宽高必须为正数", path: ["w"] });
    }
    // Fixed canvas: objects may not extend beyond the slide surface. We allow
    // x/y >= 0 here and reject negatives; checkPptDocument enforces bounds so
    // zod errors stay local and structural.
    if (rect.x < 0 || rect.y < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "固定画布不允许负坐标", path: ["x"] });
    }
    if (rect.x + rect.w > SLIDE_WIDTH + 1e-9 || rect.y + rect.h > SLIDE_HEIGHT + 1e-9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "对象超出幻灯片边界", path: ["x"] });
    }
  });
export type Rect = z.infer<typeof rectSchema>;

export const themeSchema = z
  .object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    background: hexColor,
    fontTitle: fontStack,
    fontBody: fontStack,
  })
  .strict();
export type PptTheme = z.infer<typeof themeSchema>;

/** Text model: paragraphs of styled runs (keeps inline edits addressable). */
export const textRunSchema = z
  .object({ text: z.string(), bold: z.boolean().optional(), italic: z.boolean().optional(), color: hexColor.optional() })
  .strict();
export type TextRun = z.infer<typeof textRunSchema>;

export const textParagraphSchema = z
  .object({ runs: z.array(textRunSchema).max(50) })
  .strict();
export type TextParagraph = z.infer<typeof textParagraphSchema>;

export const shapeKindSchema = z.enum(["rect", "round", "ellipse", "triangle", "arrow"]);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

export const chartTypeSchema = z.enum(["bar", "line", "pie"]);
export type ChartType = z.infer<typeof chartTypeSchema>;

export const chartPointSchema = z.object({ label: z.string(), value: z.number() }).strict();
export const chartSeriesSchema = z.object({ name: z.string(), points: z.array(chartPointSchema).min(1).max(24) }).strict();

export const tableCellSchema = z.object({ text: z.string() }).strict();
export const tableMatrixSchema = z.array(z.array(tableCellSchema).min(1).max(20)).min(1).max(50);

export const placeholderSubtypeSchema = z.enum(["title", "content", "subtitle", "notes"]);

/**
 * Discriminated union by object kind. zod strip mode: unknown keys drop on
 * parse; documentVersion literal guards cross-version evolution.
 */
const baseObjectSchema = z.object({
  id: objectId,
  rect: rectSchema,
  locked: z.boolean().optional(),
}).strict();

export const textObjectSchema = baseObjectSchema.extend({
  kind: z.literal("text"),
  title: z.string().optional(),
  paragraphs: z.array(textParagraphSchema).max(20),
  fontSize: z.number().min(4).max(400).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  /** Per-object font family override (otherwise the theme font applies). */
  fontFamily: fontStack.optional(),
}).strict();

/** Linear gradient imported from OOXML gradFill (angle in degrees). */
export const gradientSchema = z
  .object({
    angle: z.number().min(0).max(360),
    stops: z
      .array(z.object({ offset: z.number().min(0).max(1), color: hexColor }).strict())
      .min(2)
      .max(8),
  })
  .strict();
export type ShapeGradient = z.infer<typeof gradientSchema>;

export const shapeObjectSchema = baseObjectSchema.extend({
  kind: z.literal("shape"),
  title: z.string().optional(),
  shape: shapeKindSchema,
  fill: hexColor.optional(),
  /** Linear gradient fill; when present it wins over `fill`. */
  gradient: gradientSchema.optional(),
  stroke: hexColor.optional(),
  /** Fill opacity 0.05–1 (e.g. the translucent shade over a cover photo). */
  opacity: z.number().min(0.05).max(1).optional(),
}).strict();

export const imageObjectSchema = baseObjectSchema.extend({
  kind: z.literal("image"),
  title: z.string().optional(),
  src: z.string().min(1).max(2000),
  fit: z.enum(["fill", "contain", "cover"]).default("contain"),
  // Visual details addressable via object.editImage (fraction 0.05–1).
  opacity: z.number().min(0.05).max(1).optional(),
  radius: z.number().min(0).max(SLIDE_WIDTH).optional(),
  border: hexColor.optional(),
}).strict();

export const tableObjectSchema = baseObjectSchema.extend({
  kind: z.literal("table"),
  title: z.string().optional(),
  rows: z.number().int().min(1).max(50),
  cols: z.number().int().min(1).max(20),
  cells: tableMatrixSchema,
}).strict();

export const chartObjectSchema = baseObjectSchema.extend({
  kind: z.literal("chart"),
  title: z.string().optional(),
  chartType: chartTypeSchema,
  series: z.array(chartSeriesSchema).min(1).max(6),
}).strict();

export const groupObjectSchema = baseObjectSchema.extend({
  kind: z.literal("group"),
  title: z.string().optional(),
  children: z.array(objectId).max(100),
}).strict();

export const placeholderObjectSchema = baseObjectSchema.extend({
  kind: z.literal("placeholder"),
  title: z.string().optional(),
  subtype: placeholderSubtypeSchema,
  text: z.string().optional(),
}).strict();

export const videoObjectSchema = baseObjectSchema.extend({
  kind: z.literal("video"),
  title: z.string().optional(),
  /** Must be a project asset URL (/api/projects/:id/assets/<sha1>.<ext>) or data: URL. */
  src: z.string().min(1).max(2000),
  /** Optional poster frame; project asset URL or data: URL; absent = native controls render black frame. */
  poster: z.string().min(1).max(2000).optional(),
}).strict();

export const slideObjectSchema = z.discriminatedUnion("kind", [
  textObjectSchema,
  shapeObjectSchema,
  imageObjectSchema,
  tableObjectSchema,
  chartObjectSchema,
  groupObjectSchema,
  placeholderObjectSchema,
  videoObjectSchema,
]);
export type PptSlideObject = z.infer<typeof slideObjectSchema>;
export type PptTextObject = z.infer<typeof textObjectSchema>;
export type PptShapeObject = z.infer<typeof shapeObjectSchema>;
export type PptImageObject = z.infer<typeof imageObjectSchema>;
export type PptTableObject = z.infer<typeof tableObjectSchema>;
export type PptChartObject = z.infer<typeof chartObjectSchema>;
export type PptGroupObject = z.infer<typeof groupObjectSchema>;
export type PptPlaceholderObject = z.infer<typeof placeholderObjectSchema>;
export type PptVideoObject = z.infer<typeof videoObjectSchema>;

export const slideSchema = z
  .object({
    id: objectId,
    title: z.string().max(200),
    layoutId: z.string().min(1).max(80).optional(),
    background: hexColor.optional(),
    notes: z.string().max(20000).default(""),
    objects: z.array(slideObjectSchema).max(500),
    locked: z.boolean().optional(),
  })
  .strict();
export type PptSlide = z.infer<typeof slideSchema>;

export const slideSizeSchema = z
  .object({ w: z.literal(SLIDE_WIDTH), h: z.literal(SLIDE_HEIGHT) })
  .strict();
export type PptSlideSize = z.infer<typeof slideSizeSchema>;

/**
 * masters/layouts kept as declared-but-empty arrays: the full PowerPoint
 * master system is out of scope for P9.1; the field reserves the shape so
 * later versions can add definitions without a breaking documentVersion bump.
 */
export const pptDocumentSchema = z
  .object({
    documentVersion: z.literal(PPT_DOCUMENT_VERSION),
    name: z.string().min(1).max(200),
    presentation: z
      .object({
        title: z.string().max(300).nullable(),
        author: z.string().max(120).nullable(),
        subject: z.string().max(300).nullable(),
      })
      .strict()
      .default({ title: null, author: null, subject: null }),
    slideSize: slideSizeSchema.default({ w: SLIDE_WIDTH, h: SLIDE_HEIGHT }),
    theme: themeSchema,
    masters: z.array(z.unknown()).max(0).default([]),
    layouts: z.array(z.unknown()).max(0).default([]),
    slides: z.array(slideSchema).max(200),
  })
  .strict();
export type PptDocument = z.infer<typeof pptDocumentSchema>;

export function validatePptDocument(input: unknown): PptDocument {
  return pptDocumentSchema.parse(input);
}

/**
 * Referential invariants beyond zod: slide/object ID uniqueness and group
 * children resolving inside the same slide (mirrors schema-core checkDocument).
 * Precondition: input must be validatePptDocument output (normalized with
 * defaults); raw JSON would TypeError on missing defaulted fields.
 */
export function checkPptDocument(doc: PptDocument): string[] {
  const issues: string[] = [];
  const slideIds = new Set<string>();
  for (const slide of doc.slides) {
    if (slideIds.has(slide.id)) issues.push(`存在重复的幻灯片 ID: ${slide.id}`);
    slideIds.add(slide.id);
    // Build the full id set FIRST: checking group children inside the same
    // loop falsely rejected groups that appear before their member objects.
    const objectIds = new Set<string>();
    const groups: Extract<PptSlideObject, { kind: "group" }>[] = [];
    for (const object of slide.objects) {
      if (objectIds.has(object.id)) issues.push(`幻灯片 "${slide.id}" 存在重复的对象 ID: ${object.id}`);
      objectIds.add(object.id);
      if (object.kind === "group") groups.push(object);
    }
    for (const group of groups) {
      for (const childId of group.children) {
        if (!objectIds.has(childId)) {
          issues.push(`分组 "${group.id}" 引用了不存在的对象 "${childId}"`);
        }
      }
    }
  }
  return issues;
}

export function findSlide(doc: PptDocument, slideId: string): PptSlide | undefined {
  return doc.slides.find((slide) => slide.id === slideId);
}

export function findObject(slide: PptSlide, objectId: string): PptSlideObject | undefined {
  return slide.objects.find((object) => object.id === objectId);
}

export function nextRectBounds(rect: Rect): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 &&
    rect.x + rect.w <= SLIDE_WIDTH + 1e-9 && rect.y + rect.h <= SLIDE_HEIGHT + 1e-9
  );
}
