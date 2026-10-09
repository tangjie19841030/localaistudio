import type { CommandDefinition, CommandResult, DocumentEnvelope } from "@studio/studio-core";
import { z } from "zod";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type PptDocument,
  type PptSlide,
  type PptSlideObject,
  type Rect,
} from "./document.js";
import {
  assertObjectEditable,
  next,
  objectScopeIds,
  requireObjectInDeck,
  requireSlide,
  withSlide,
  type PptCommand,
} from "./object-shared.js";
import { PptCommandError } from "./utils.js";

/** Fixed-canvas guard shared by add/move/resize/align. */
function assertRectInsideCanvas(rect: Rect, what: string): void {
  const inside =
    rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 &&
    rect.x + rect.w <= SLIDE_WIDTH + 1e-9 && rect.y + rect.h <= SLIDE_HEIGHT + 1e-9;
  if (!inside) throw new PptCommandError(`${what} 超出固定画布范围（${SLIDE_WIDTH}x${SLIDE_HEIGHT}）或几何非法`);
}

// ---------------------------------------------------------------------------
// object.move / object.resize / object.align share rect application

function applyRect(
  envelope: DocumentEnvelope<PptDocument>,
  slide: PptSlide,
  object: PptSlideObject,
  rect: Rect,
  summary: string,
): CommandResult<PptDocument> {
  let objects = slide.objects.map((candidate) => (candidate.id === object.id ? { ...candidate, rect } : candidate));
  // A group shell carries ids, not geometry: moving it must translate its
  // (possibly nested) children together or shell and members drift apart.
  if (object.kind === "group") {
    objects = moveGroupMembers(slide, objects, object, rect.x - object.rect.x, rect.y - object.rect.y);
  }
  return next(envelope, withSlide(envelope.document, { ...slide, objects }), summary, [object.id], objectScopeIds(slide.id, [object.id]));
}

/** All member ids of a group, recursively (nested groups included). */
function groupMemberIds(slide: PptSlide, groupId: string): Set<string> {
  const ids = new Set<string>();
  const walk = (g: Extract<PptSlideObject, { kind: "group" }>): void => {
    for (const childId of g.children) {
      ids.add(childId);
      const child = slide.objects.find((c) => c.id === childId);
      if (child?.kind === "group") walk(child);
    }
  };
  const root = slide.objects.find((c) => c.id === groupId);
  if (root?.kind === "group") walk(root);
  return ids;
}

function clampX(x: number, w: number): number {
  return Math.max(0, Math.min(x, SLIDE_WIDTH - w));
}
function clampY(y: number, h: number): number {
  return Math.max(0, Math.min(y, SLIDE_HEIGHT - h));
}

function moveGroupMembers(
  slide: PptSlide,
  objects: PptSlideObject[],
  group: Extract<PptSlideObject, { kind: "group" }>,
  dx: number,
  dy: number,
): PptSlideObject[] {
  const members = groupMemberIds(slide, group.id);
  return objects.map((candidate) => {
    if (!members.has(candidate.id)) return candidate;
    return {
      ...candidate,
      rect: {
        ...candidate.rect,
        x: clampX(candidate.rect.x + dx, candidate.rect.w),
        y: clampY(candidate.rect.y + dy, candidate.rect.h),
      },
    };
  });
}

const moveArgs = z
  .object({ objectId: z.string().min(1).max(80), x: z.number(), y: z.number() })
  .strict();

const objectMoveCommand: PptCommand<z.infer<typeof moveArgs>> = {
  id: "object.move",
  title: "移动幻灯片对象",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: moveArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    const rect = { ...object.rect, x: args.x, y: args.y };
    assertRectInsideCanvas(rect, "移动后的对象");
    return applyRect(envelope, slide, object, rect, `已移动对象 ${args.objectId}`);
  },
};

const resizeArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict(),
  })
  .strict();

const objectResizeCommand: PptCommand<z.infer<typeof resizeArgs>> = {
  id: "object.resize",
  title: "调整对象尺寸",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: resizeArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind === "group") {
      throw new PptCommandError("分组外壳不能直接缩放；请先取消分组后调整成员，再重新组合");
    }
    assertRectInsideCanvas(args.rect as Rect, "调整后的对象");
    return applyRect(envelope, slide, object, args.rect as Rect, `已调整对象 ${args.objectId} 的尺寸`);
  },
};

const ALIGN_TITLES: Record<string, string> = {
  left: "左对齐到幻灯片",
  right: "右对齐到幻灯片",
  top: "顶对齐到幻灯片",
  bottom: "底对齐到幻灯片",
  hcenter: "水平居中到幻灯片",
  vcenter: "垂直居中到幻灯片",
};

function alignedRect(rect: Rect, edge: string): Rect {
  switch (edge) {
    case "left":
      return { ...rect, x: 0 };
    case "right":
      return { ...rect, x: SLIDE_WIDTH - rect.w };
    case "top":
      return { ...rect, y: 0 };
    case "bottom":
      return { ...rect, y: SLIDE_HEIGHT - rect.h };
    case "hcenter":
      return { ...rect, x: (SLIDE_WIDTH - rect.w) / 2 };
    case "vcenter":
      return { ...rect, y: (SLIDE_HEIGHT - rect.h) / 2 };
    default:
      throw new PptCommandError(`未知对齐方式: ${edge}`);
  }
}

const alignArgs = z
  .object({ objectId: z.string().min(1).max(80), edge: z.enum(["left", "right", "top", "bottom", "hcenter", "vcenter"]) })
  .strict();

const objectAlignCommand: PptCommand<z.infer<typeof alignArgs>> = {
  id: "object.align",
  title: "对齐对象到幻灯片",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: alignArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    const rect = alignedRect(object.rect, args.edge);
    return applyRect(envelope, slide, object, rect, `已${ALIGN_TITLES[args.edge] ?? "对齐"}: ${args.objectId}`);
  },
};

// ---------------------------------------------------------------------------
// object.distribute

const distributeArgs = z
  .object({
    slideId: z.string().min(1).max(80),
    objectIds: z.array(z.string().min(1).max(80)).min(3).max(50),
    axis: z.enum(["horizontal", "vertical"]),
  })
  .strict();

/** Even spacing between the outermost objects along one axis. */
function distributeAxis(objects: PptSlideObject[], axis: "horizontal" | "vertical"): Map<string, number> {
  const pos = (object: PptSlideObject) => (axis === "horizontal" ? object.rect.x : object.rect.y);
  const size = (object: PptSlideObject) => (axis === "horizontal" ? object.rect.w : object.rect.h);
  const sorted = [...objects].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = pos(last) + size(last) - pos(first);
  const total = objects.reduce((sum, object) => sum + size(object), 0);
  const gap = (span - total) / (objects.length - 1);
  if (gap < 0) throw new PptCommandError(axis === "horizontal" ? "选区水平空间不足，无法等距分布" : "选区垂直空间不足，无法等距分布");
  const positions = new Map<string, number>();
  let cursor = pos(first);
  for (const object of sorted) {
    positions.set(object.id, cursor);
    cursor += size(object) + gap;
  }
  return positions;
}

const objectDistributeCommand: PptCommand<z.infer<typeof distributeArgs>> = {
  id: "object.distribute",
  title: "在选区内等距分布对象",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: distributeArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    const objects = args.objectIds.map((id) => {
      const object = slide.objects.find((candidate) => candidate.id === id);
      if (!object) throw new PptCommandError(`幻灯片 "${slide.id}" 中不存在对象: ${id}`);
      assertObjectEditable(slide, id);
      return object;
    });
    const positions = distributeAxis(objects, args.axis);
    const isX = args.axis === "horizontal";
    const updated = slide.objects.map((object) => {
      const at = positions.get(object.id);
      if (at === undefined) return object;
      return { ...object, rect: isX ? { ...object.rect, x: at } : { ...object.rect, y: at } };
    });
    const affected = objects.map((object) => object.id);
    const label = isX ? "水平" : "垂直";
    return next(
      envelope,
      withSlide(doc, { ...slide, objects: updated }),
      `已${label}等距分布 ${affected.length} 个对象`,
      affected,
      objectScopeIds(slide.id, affected),
    );
  },
};

// ---------------------------------------------------------------------------
// object.alignMany: align a SELECTION against each other (object.align aligns
// one object to the slide edge — the two must not be confused by the model).

const alignManyEdges = ["left", "right", "top", "bottom", "hcenter", "vcenter"] as const;
const alignManyArgs = z
  .object({
    slideId: z.string().min(1).max(80),
    objectIds: z.array(z.string().min(1).max(80)).min(2).max(50),
    edge: z.enum(alignManyEdges),
  })
  .strict();

const objectAlignManyCommand: PptCommand<z.infer<typeof alignManyArgs>> = {
  id: "object.alignMany",
  title: "多个对象互相对齐",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: alignManyArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
    const targets = args.objectIds.map((id) => {
      const object = slide.objects.find((candidate) => candidate.id === id);
      if (!object) throw new PptCommandError(`幻灯片 "${slide.id}" 中不存在对象: ${id}`);
      assertObjectEditable(slide, id);
      return object;
    });
    const minLeft = Math.min(...targets.map((o) => o.rect.x));
    const minTop = Math.min(...targets.map((o) => o.rect.y));
    const maxRight = Math.max(...targets.map((o) => o.rect.x + o.rect.w));
    const maxBottom = Math.max(...targets.map((o) => o.rect.y + o.rect.h));
    const targetFor = (rect: Rect): Partial<Rect> => {
      switch (args.edge) {
        case "left":
          return { x: minLeft };
        case "right":
          return { x: maxRight - rect.w };
        case "top":
          return { y: minTop };
        case "bottom":
          return { y: maxBottom - rect.h };
        case "hcenter":
          return { x: (minLeft + maxRight) / 2 - rect.w / 2 };
        case "vcenter":
          return { y: (minTop + maxBottom) / 2 - rect.h / 2 };
      }
    };
    const updated = slide.objects.map((candidate) => {
      if (!args.objectIds.includes(candidate.id)) return candidate;
      return { ...candidate, rect: { ...candidate.rect, ...targetFor(candidate.rect) } };
    });
    // Groups keep their members in step.
    let objects = updated;
    for (const target of targets) {
      if (target.kind === "group") {
        const after = objects.find((o) => o.id === target.id)!;
        objects = moveGroupMembers(slide, objects, target, after.rect.x - target.rect.x, after.rect.y - target.rect.y);
      }
    }
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已${ALIGN_MANY_TITLES[args.edge]} ${targets.length} 个对象`,
      args.objectIds,
      objectScopeIds(slide.id, args.objectIds),
    );
  },
};

const ALIGN_MANY_TITLES: Record<(typeof alignManyEdges)[number], string> = {
  left: "左对齐",
  right: "右对齐",
  top: "顶对齐",
  bottom: "底对齐",
  hcenter: "水平居中对齐",
  vcenter: "垂直居中对齐",
};

// Geometry/layout domain: object.move / object.resize / object.align /
// object.alignMany / object.distribute (registry slice order preserved).

export const OBJECT_LAYOUT_COMMANDS: CommandDefinition<PptDocument>[] = [
  objectMoveCommand,
  objectResizeCommand,
  objectAlignCommand,
  objectAlignManyCommand,
  objectDistributeCommand,
];
