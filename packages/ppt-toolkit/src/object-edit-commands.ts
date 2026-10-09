import type { CommandDefinition } from "@studio/studio-core";
import { z } from "zod";
import {
  SLIDE_WIDTH,
  chartSeriesSchema,
  hexColor,
  shapeKindSchema,
  tableMatrixSchema,
  textParagraphSchema,
  type PptDocument,
  type PptSlideObject,
} from "./document.js";
import {
  assertObjectEditable,
  next,
  objectScopeIds,
  requireObjectInDeck,
  withSlide,
  type PptCommand,
} from "./object-shared.js";
import { PptCommandError } from "./utils.js";

// ---------------------------------------------------------------------------
// object.editText

const editTextArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    // paragraphs is OPTIONAL: fontSize/align can be patched without resending
    // the full text. A typo'd data.fontSize used to burn the whole step budget.
    paragraphs: z.array(textParagraphSchema).max(20).optional(),
    fontSize: z.number().min(4).max(400).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    fontFamily: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine(
    (a) => a.paragraphs !== undefined || a.fontSize !== undefined || a.align !== undefined || a.fontFamily !== undefined,
    { message: "至少提供 paragraphs/fontSize/align/fontFamily 之一" },
  );

const PLACEHOLDER_DEFAULT_FONT_SIZE: Record<string, number> = { title: 40, subtitle: 24, content: 18, notes: 18 };

const objectEditTextCommand: PptCommand<z.infer<typeof editTextArgs>> = {
  id: "object.editText",
  title: "编辑文本对象内容",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: editTextArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);

    // Placeholders are filled IN PLACE: same id/rect, converted to a real text
    // object (the old "remove + re-add" dance lost selection and guessed size).
    if (object.kind === "placeholder") {
      const paragraphs =
        args.paragraphs ??
        (object.text ? [{ runs: [{ text: object.text }] }] : [{ runs: [{ text: "" }] }]);
      const converted: PptSlideObject = {
        id: object.id,
        kind: "text",
        rect: object.rect,
        paragraphs,
        ...(args.fontSize !== undefined
          ? { fontSize: args.fontSize }
          : { fontSize: PLACEHOLDER_DEFAULT_FONT_SIZE[object.subtype] ?? 18 }),
        ...(args.align ? { align: args.align } : {}),
        ...(object.locked ? { locked: object.locked } : {}),
      };
      const objects = slide.objects.map((candidate) => (candidate.id === object.id ? converted : candidate));
      return next(
        envelope,
        withSlide(doc, { ...slide, objects }),
        `已填入占位符 ${args.objectId}`,
        [args.objectId],
        objectScopeIds(slide.id, [args.objectId]),
      );
    }
    if (object.kind !== "text") throw new PptCommandError(`对象 ${args.objectId} 不是文本对象`);
    const updated: PptSlideObject = {
      ...object,
      ...(args.paragraphs !== undefined ? { paragraphs: args.paragraphs } : {}),
      ...(args.fontSize !== undefined ? { fontSize: args.fontSize } : {}),
      ...(args.align !== undefined ? { align: args.align } : {}),
      ...(args.fontFamily !== undefined ? { fontFamily: args.fontFamily } : {}),
    };
    const objects = slide.objects.map((candidate) => (candidate.id === object.id ? updated : candidate));
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已编辑文本 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.editShape (fill / stroke / shape kind — previously AI had no command)

const editShapeArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    shape: shapeKindSchema.optional(),
    fill: hexColor.nullable().optional(),
    stroke: hexColor.nullable().optional(),
    opacity: z.number().min(0.05).max(1).optional(),
  })
  .strict()
  .refine((a) => a.shape !== undefined || a.fill !== undefined || a.stroke !== undefined || a.opacity !== undefined, {
    message: "至少提供 shape/fill/stroke 之一",
  });

const objectEditShapeCommand: PptCommand<z.infer<typeof editShapeArgs>> = {
  id: "object.editShape",
  title: "编辑形状样式",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: editShapeArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind !== "shape") throw new PptCommandError(`对象 ${args.objectId} 不是形状对象`);
    const finalObj: PptSlideObject = {
      ...object,
      ...(args.shape ? { shape: args.shape } : {}),
      // A solid-color edit replaces any imported gradient (otherwise the
      // gradient keeps winning at render time and the color "doesn't apply").
      ...(args.fill !== undefined && args.fill !== null ? { fill: args.fill } : {}),
      ...(args.stroke !== undefined && args.stroke !== null ? { stroke: args.stroke } : {}),
      ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
    };
    if (args.fill !== undefined && "gradient" in finalObj) {
      delete (finalObj as { gradient?: unknown }).gradient;
    }
    // Explicit null removes the color (spread can't delete an inherited key).
    if (args.fill === null && "fill" in finalObj) delete (finalObj as { fill?: string }).fill;
    if (args.stroke === null && "stroke" in finalObj) delete (finalObj as { stroke?: string }).stroke;
    const objects = slide.objects.map((candidate) => (candidate.id === object.id ? finalObj : candidate));
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已编辑形状样式 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.editImage (swap src / fit / title of an existing image — used both by
// the manual "upload replacement image" flow and by the AI after a user uploads
// a new project asset)

const editImageArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    src: z.string().min(1).max(2000),
    fit: z.enum(["fill", "contain", "cover"]).optional(),
    title: z.string().max(200).optional(),
    opacity: z.number().min(0.05).max(1).optional(),
    radius: z.number().min(0).max(SLIDE_WIDTH).optional(),
    border: hexColor.nullable().optional(),
  })
  .strict();

const objectEditImageCommand: PptCommand<z.infer<typeof editImageArgs>> = {
  id: "object.editImage",
  title: "替换图片对象的图片",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: editImageArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind !== "image") throw new PptCommandError(`对象 ${args.objectId} 不是图片对象`);
    const updated = {
      ...object,
      src: args.src,
      ...(args.fit !== undefined ? { fit: args.fit } : {}),
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
      ...(args.radius !== undefined ? { radius: args.radius } : {}),
      ...(args.border !== undefined && args.border !== null ? { border: args.border } : {}),
    };
    if (args.border === null && "border" in updated) delete (updated as { border?: string }).border;
    const objects = slide.objects.map((candidate) => (candidate.id === object.id ? updated : candidate));
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已替换图片 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.editVideo (swap src / poster / title of an existing video — mirrors
// object.editImage for the manual "replace video" flow and the AI edit path)

const editVideoArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    src: z.string().min(1).max(2000).optional(),
    // null clears the poster (video falls back to the native first frame).
    poster: z.string().min(1).max(2000).nullable().optional(),
    title: z.string().max(200).optional(),
  })
  .strict()
  .refine((a) => a.src !== undefined || a.poster !== undefined || a.title !== undefined, {
    message: "至少提供 src/poster/title 之一",
  });

const objectEditVideoCommand: PptCommand<z.infer<typeof editVideoArgs>> = {
  id: "object.editVideo",
  title: "编辑视频对象的源或封面",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: editVideoArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind !== "video") throw new PptCommandError(`对象 ${args.objectId} 不是视频对象`);
    const updated = {
      ...object,
      ...(args.src !== undefined ? { src: args.src } : {}),
      ...(args.poster !== undefined && args.poster !== null ? { poster: args.poster } : {}),
      ...(args.title !== undefined ? { title: args.title } : {}),
    };
    // Explicit null removes the poster (spread can't delete an inherited key).
    if (args.poster === null && "poster" in updated) delete (updated as { poster?: string }).poster;
    const objects = slide.objects.map((candidate) => (candidate.id === object.id ? updated : candidate));
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已编辑视频 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.editTable (whole cell-matrix replacement; rows/cols derived)

const editTableArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    cells: tableMatrixSchema.optional(),
    title: z.string().max(200).optional(),
  })
  .strict()
  .refine((a) => a.cells !== undefined || a.title !== undefined, {
    message: "至少提供 cells/title 之一",
  });

const objectEditTableCommand: PptCommand<z.infer<typeof editTableArgs>> = {
  id: "object.editTable",
  title: "编辑表格内容",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: editTableArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind !== "table") throw new PptCommandError(`对象 ${args.objectId} 不是表格对象`);
    const updated: PptSlideObject = {
      ...object,
      ...(args.cells ? { cells: args.cells, rows: args.cells.length, cols: args.cells[0]!.length } : {}),
      ...(args.title !== undefined ? { title: args.title } : {}),
    };
    const objects = slide.objects.map((candidate) => (candidate.id === object.id ? updated : candidate));
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已编辑表格 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.editChart (chart type / series / title)

const editChartArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    chartType: z.enum(["bar", "line", "pie"]).optional(),
    series: z.array(chartSeriesSchema).min(1).max(6).optional(),
    title: z.string().max(200).optional(),
  })
  .strict()
  .refine((a) => a.chartType !== undefined || a.series !== undefined || a.title !== undefined, {
    message: "至少提供 chartType/series/title 之一",
  });

const objectEditChartCommand: PptCommand<z.infer<typeof editChartArgs>> = {
  id: "object.editChart",
  title: "编辑图表数据或类型",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: editChartArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind !== "chart") throw new PptCommandError(`对象 ${args.objectId} 不是图表对象`);
    const updated: PptSlideObject = {
      ...object,
      ...(args.chartType ? { chartType: args.chartType } : {}),
      ...(args.series ? { series: args.series } : {}),
      ...(args.title !== undefined ? { title: args.title } : {}),
    };
    const objects = slide.objects.map((candidate) => (candidate.id === object.id ? updated : candidate));
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已编辑图表 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// Content-editing domain: object.editText / object.editShape / object.editImage
// / object.editVideo / object.editTable / object.editChart (registry slice
// order preserved).

export const OBJECT_EDIT_COMMANDS: CommandDefinition<PptDocument>[] = [
  objectEditTextCommand,
  objectEditShapeCommand,
  objectEditImageCommand,
  objectEditVideoCommand,
  objectEditTableCommand,
  objectEditChartCommand,
];
