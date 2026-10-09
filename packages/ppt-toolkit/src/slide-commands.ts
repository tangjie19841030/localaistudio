import type { CommandDefinition, CommandResult } from "@studio/studio-core";
import { z } from "zod";
import { checkPptDocument, type PptDocument, type PptSlide } from "./document.js";
import { applyLayoutTemplate, createSlideFromLayout, PPT_LAYOUT_IDS } from "./layout.js";
import { writeNotes } from "./notes.js";
import { applyTheme, getTheme } from "./theme.js";
import { assertUniqueId, PptCommandError, uniqueId } from "./utils.js";

type PptCommand<TArgs> = CommandDefinition<PptDocument, TArgs>;

function next(
  envelope: import("@studio/studio-core").DocumentEnvelope<PptDocument>,
  document: PptDocument,
  summary: string,
  affectedIds: string[],
  scopeIds: string[],
): CommandResult<PptDocument> {
  return { nextEnvelope: { ...envelope, document }, summary, affectedIds, scopeIds };
}

function requireSlide(doc: PptDocument, slideId: string): PptSlide {
  const slide = doc.slides.find((candidate) => candidate.id === slideId);
  if (!slide) throw new PptCommandError(`幻灯片不存在: ${slideId}`);
  return slide;
}

function withSlide(doc: PptDocument, slide: PptSlide): PptDocument {
  return { ...doc, slides: doc.slides.map((candidate) => (candidate.id === slide.id ? slide : candidate)) };
}

function withSlides(doc: PptDocument, slides: PptSlide[]): PptDocument {
  return { ...doc, slides };
}

const layoutIdSchema = z.enum(PPT_LAYOUT_IDS);

// ---------------------------------------------------------------------------
// slide.add

const addSlideArgs = z
  .object({
    title: z.string().min(1).max(200).optional(),
    layout: layoutIdSchema.optional(),
    slideId: z.string().min(1).max(80).optional(),
    index: z.number().int().min(0).optional(),
    notes: z.string().max(20000).optional(),
  })
  .strict();

const slideAddCommand: PptCommand<z.infer<typeof addSlideArgs>> = {
  id: "slide.add",
  title: "新增幻灯片",
  riskLevel: "low",
  allowedScopeKinds: ["file"],
  parameters: addSlideArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const taken = new Set(doc.slides.map((slide) => slide.id));
    if (args.slideId !== undefined) assertUniqueId(taken, args.slideId, "幻灯片");
    let slide = createSlideFromLayout(args.layout ?? "blank", taken, args.title);
    if (args.slideId !== undefined) slide = { ...slide, id: args.slideId };
    const slides = [...doc.slides];
    slides.splice(args.index ?? slides.length, 0, slide);
    const document = withSlides(doc, slides);
    const notesDoc = args.notes !== undefined ? writeNotes(document, slide.id, args.notes) : document;
    return {
      ...next(envelope, notesDoc, `已新增幻灯片 "${slide.title}"，新幻灯片 id 为 ${slide.id}`, [slide.id], []),
      createdIds: [slide.id],
    };
  },
};

// ---------------------------------------------------------------------------
// slide.duplicate

const slideDuplicateArgs = z
  .object({ slideId: z.string().min(1).max(80), newSlideId: z.string().min(1).max(80).optional() })
  .strict();

const slideDuplicateCommand: PptCommand<z.infer<typeof slideDuplicateArgs>> = {
  id: "slide.duplicate",
  title: "复制幻灯片",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container"],
  parameters: slideDuplicateArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const source = requireSlide(doc, args.slideId);
    const takenIds = new Set(doc.slides.map((slide) => slide.id));
    const newId = args.newSlideId ?? uniqueId(`${source.id}-copy`, takenIds);
    assertUniqueId(takenIds, newId, "幻灯片");
    // Clone objects with fresh ids; groups re-point at the cloned children.
    const used = new Set(source.objects.map((object) => object.id));
    const idMap = new Map<string, string>();
    for (const object of source.objects) {
      const cloneId = uniqueId(`${newId}-${object.id}`, new Set([...used, ...idMap.values()]));
      idMap.set(object.id, cloneId);
    }
    const cloned = source.objects.map((object) => {
      const clonedObject = { ...object, id: idMap.get(object.id)!, locked: false };
      return clonedObject.kind === "group"
        ? { ...clonedObject, children: clonedObject.children.map((childId) => idMap.get(childId)!) }
        : clonedObject;
    });
    const duplicate: PptSlide = { ...source, id: newId, title: `${source.title}（副本）`, locked: false, objects: cloned };
    const slides = [...doc.slides];
    slides.splice(doc.slides.findIndex((slide) => slide.id === args.slideId) + 1, 0, duplicate);
    return {
      ...next(envelope, withSlides(doc, slides), `已复制幻灯片 "${source.title}"，新幻灯片 id 为 ${newId}`, [newId], [args.slideId]),
      createdIds: [newId],
    };
  },
};

// ---------------------------------------------------------------------------
// slide.remove

const slideRemoveArgs = z.object({ slideId: z.string().min(1).max(80) }).strict();

const slideRemoveCommand: PptCommand<z.infer<typeof slideRemoveArgs>> = {
  id: "slide.remove",
  title: "删除幻灯片",
  riskLevel: "medium",
  allowedScopeKinds: ["file", "container"],
  parameters: slideRemoveArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
    if (doc.slides.length <= 1) throw new PptCommandError("演示文稿至少保留一张幻灯片");
    return next(
      envelope,
      withSlides(doc, doc.slides.filter((candidate) => candidate.id !== args.slideId)),
      `已删除幻灯片 "${slide.title}"`,
      [args.slideId],
      [args.slideId],
    );
  },
};

// ---------------------------------------------------------------------------
// slide.reorder

const slideReorderArgs = z
  .object({ slideId: z.string().min(1).max(80), index: z.number().int().min(0) })
  .strict();

const slideReorderCommand: PptCommand<z.infer<typeof slideReorderArgs>> = {
  id: "slide.reorder",
  title: "调整幻灯片顺序",
  riskLevel: "low",
  allowedScopeKinds: ["file"],
  parameters: slideReorderArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const current = doc.slides.findIndex((slide) => slide.id === args.slideId);
    if (current < 0) throw new PptCommandError(`幻灯片不存在: ${args.slideId}`);
    if (args.index >= doc.slides.length) throw new PptCommandError(`目标位置超出范围: ${args.index}`);
    const slides = [...doc.slides];
    const [moved] = slides.splice(current, 1);
    slides.splice(args.index, 0, moved!);
    return next(envelope, withSlides(doc, slides), "已调整幻灯片顺序", [args.slideId], [args.slideId]);
  },
};

// ---------------------------------------------------------------------------
// slide.rename

const slideRenameArgs = z
  .object({ slideId: z.string().min(1).max(80), title: z.string().min(1).max(200) })
  .strict();

const slideRenameCommand: PptCommand<z.infer<typeof slideRenameArgs>> = {
  id: "slide.rename",
  title: "重命名幻灯片",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container"],
  parameters: slideRenameArgs,
  execute(envelope, args) {
    const slide = requireSlide(envelope.document, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${args.slideId}`);
    return next(envelope, withSlide(envelope.document, { ...slide, title: args.title }), `已重命名幻灯片为 "${args.title}"`, [args.slideId], [args.slideId]);
  },
};

// ---------------------------------------------------------------------------
// slide.lock

const slideLockArgs = z.object({ slideId: z.string().min(1).max(80), locked: z.boolean() }).strict();

const slideLockCommand: PptCommand<z.infer<typeof slideLockArgs>> = {
  id: "slide.lock",
  title: "锁定或解锁幻灯片",
  riskLevel: "medium",
  allowedScopeKinds: ["file", "container"],
  parameters: slideLockArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    const wasLocked = slide.locked === true;
    return {
      ...next(
        envelope,
        withSlide(doc, { ...slide, locked: args.locked }),
        args.locked ? `已锁定幻灯片 "${slide.title}"` : `已解锁幻灯片 "${slide.title}"`,
        [args.slideId],
        [args.slideId],
      ),
      ...(wasLocked && !args.locked ? { lockOverrideIds: [args.slideId] } : {}),
    };
  },
};

// ---------------------------------------------------------------------------
// slide.setNotes

const slideNotesArgs = z
  .object({ slideId: z.string().min(1).max(80), notes: z.string().max(20000) })
  .strict();

const slideSetNotesCommand: PptCommand<z.infer<typeof slideNotesArgs>> = {
  id: "slide.setNotes",
  title: "设置幻灯片备注",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container"],
  parameters: slideNotesArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
    return next(envelope, writeNotes(doc, args.slideId, args.notes), `已更新幻灯片 "${slide.title}" 的备注`, [args.slideId], [args.slideId]);
  },
};

// ---------------------------------------------------------------------------
// slide.applyLayout

const applyLayoutArgs = z
  .object({ slideId: z.string().min(1).max(80), layout: layoutIdSchema })
  .strict();

const slideApplyLayoutCommand: PptCommand<z.infer<typeof applyLayoutArgs>> = {
  id: "slide.applyLayout",
  title: "应用幻灯片布局模板",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container"],
  parameters: applyLayoutArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
    const updated = applyLayoutTemplate(slide, args.layout);
    if (checkPptDocument({ ...doc, slides: [updated] }).length > 0) {
      throw new PptCommandError("布局模板生成的对象冲突");
    }
    return next(envelope, withSlide(doc, updated), `已应用布局 "${args.layout}"`, [args.slideId], [args.slideId]);
  },
};

// ---------------------------------------------------------------------------
// theme.apply

const themeApplyArgs = z.object({ themeId: z.string().min(1).max(40) }).strict();

const themeApplyCommand: PptCommand<z.infer<typeof themeApplyArgs>> = {
  id: "theme.apply",
  title: "切换整体主题",
  riskLevel: "medium",
  allowedScopeKinds: ["file"],
  parameters: themeApplyArgs,
  execute(envelope, args) {
    const theme = getTheme(args.themeId);
    if (!theme) throw new PptCommandError(`未知主题: ${args.themeId}`);
    return next(envelope, applyTheme(envelope.document, theme), `已切换主题 "${args.themeId}"`, [], []);
  },
};

// ---------------------------------------------------------------------------
// slide.setBackground (slide.background existed and rendered but had no writer)

const setBackgroundArgs = z
  .object({
    slideId: z.string().min(1).max(80),
    // null clears the override and falls back to the theme background.
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  })
  .strict();

const slideSetBackgroundCommand: PptCommand<z.infer<typeof setBackgroundArgs>> = {
  id: "slide.setBackground",
  title: "设置幻灯片背景色",
  riskLevel: "low",
  // Selection reach always includes the owning slide (adapter anchor).
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: setBackgroundArgs,
  execute(envelope, args) {
    const slide = requireSlide(envelope.document, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${args.slideId}`);
    const updated = { ...slide };
    if (args.color === null || args.color === undefined) delete (updated as { background?: string }).background;
    else updated.background = args.color;
    return next(
      envelope,
      withSlide(envelope.document, updated),
      args.color ? `已设置背景色 ${args.color}` : "已恢复主题背景",
      [args.slideId],
      [args.slideId],
    );
  },
};

export const SLIDE_COMMANDS: CommandDefinition<PptDocument>[] = [
  slideAddCommand,
  slideDuplicateCommand,
  slideRemoveCommand,
  slideReorderCommand,
  slideRenameCommand,
  slideLockCommand,
  slideSetNotesCommand,
  slideApplyLayoutCommand,
  slideSetBackgroundCommand,
  themeApplyCommand,
];
