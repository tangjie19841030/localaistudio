import { z } from "zod";
import { slideObjectSchema, type PptSlideObject, type Rect } from "./document.js";
import { assertRectInsideCanvas, PptCommandError } from "./utils.js";

/**
 * Draft schema for object.add: a thin, kind-agnostic payload that the
 * command materializes into a full domain object. Keeping the draft loose
 * (data record) avoids one giant zod union in the command args while the
 * domain schema still validates the final object.
 */
export const objectDraftSchema = z
  .object({
    id: z.string().min(1).max(80).optional(),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict(),
    kind: z.enum(["text", "shape", "image", "table", "chart", "group", "video"]),
    locked: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const objectAddArgsSchema = z
  .object({
    slideId: z.string().min(1).max(80),
    object: objectDraftSchema,
    index: z.number().int().min(0).optional(),
  })
  .strict();

export type ObjectDraft = z.infer<typeof objectDraftSchema>;

/** Build a domain object from an add-command draft (kind-specific defaults in data). */
export function materializeObject(draft: ObjectDraft): PptSlideObject {
  const rect = draft.rect as Rect;
  assertRectInsideCanvas(rect, "对象几何");
  const base = { rect, ...(draft.locked !== undefined ? { locked: draft.locked } : {}) };
  const draftParsed = slideObjectSchema.safeParse({ ...base, ...kindPayload(draft), id: "pending" });
  if (!draftParsed.success) {
    const issues = draftParsed.error.issues
      .filter((issue) => issue.path[0] !== "id")
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new PptCommandError(`对象数据无效: ${issues.join("; ")}`);
  }
  return draftParsed.data;
}

function kindPayload(draft: ObjectDraft): Record<string, unknown> {
  const data = draft.data ?? {};
  switch (draft.kind) {
    case "text":
      return { kind: "text", paragraphs: data.paragraphs ?? [], ...pick(data, "fontSize", "align", "title") };
    case "shape":
      return { kind: "shape", shape: str(data, "shape", "rect"), ...pick(data, "fill", "stroke", "title") };
    case "image":
      return { kind: "image", src: str(data, "src", ""), fit: str(data, "fit", "contain"), ...pick(data, "title") };
    case "table":
      return { kind: "table", rows: num(data, "rows", 1), cols: num(data, "cols", 1), cells: (data.cells as unknown[] | undefined) ?? [[{ text: "" }]] };
    case "chart":
      return { kind: "chart", chartType: str(data, "chartType", "bar"), series: (data.series as unknown[] | undefined) ?? [] };
    case "group":
      return { kind: "group", children: (data.children as string[] | undefined) ?? [] };
    case "video":
      return { kind: "video", src: str(data, "src", ""), ...pick(data, "poster", "title") };
    default:
      throw new PptCommandError(`不支持的对象类型: ${String(draft.kind)}`);
  }
}

function pick(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in data) out[key] = data[key];
  return out;
}

function str(data: Record<string, unknown>, key: string, fallback: string): string {
  return typeof data[key] === "string" ? (data[key] as string) : fallback;
}

function num(data: Record<string, unknown>, key: string, fallback: number): number {
  return typeof data[key] === "number" ? (data[key] as number) : fallback;
}
