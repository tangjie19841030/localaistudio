import type { CommandDefinition } from "@studio/studio-core";
import { z } from "zod";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type PptDocument, type PptSlideObject, type Rect } from "./document.js";
import { materializeObject, objectAddArgsSchema } from "./object-add.js";
import {
  assertObjectEditable,
  next,
  objectScopeIds,
  requireObjectInDeck,
  requireSlide,
  withSlide,
  type PptCommand,
} from "./object-shared.js";
import { assertUniqueId, PptCommandError, uniqueId } from "./utils.js";

// ---------------------------------------------------------------------------
// object.add (draft schema + materialization live in object-add.ts)

const objectAddCommand: PptCommand<z.infer<typeof objectAddArgsSchema>> = {
  id: "object.add",
  title: "新增幻灯片对象",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: objectAddArgsSchema,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
    const taken = new Set(slide.objects.map((object) => object.id));
    if (args.object.id !== undefined) assertUniqueId(taken, args.object.id, "对象");
    const materialized = materializeObject(args.object);
    const id = args.object.id ?? uniqueId(`${slide.id}-${args.object.kind}`, taken);
    const object: PptSlideObject = { ...materialized, id };
    const objects: PptSlideObject[] = [...slide.objects];
    objects.splice(args.index ?? objects.length, 0, object);
    return {
      ...next(
        envelope,
        withSlide(doc, { ...slide, objects }),
        `已在幻灯片 "${slide.title}" 新增 ${args.object.kind} 对象`,
        [id],
        [args.slideId],
      ),
      createdIds: [id],
    };
  },
};

// ---------------------------------------------------------------------------
// object.group / object.ungroup

const groupArgs = z
  .object({
    slideId: z.string().min(1).max(80),
    objectIds: z.array(z.string().min(1).max(80)).min(2).max(100),
    id: z.string().min(1).max(80).optional(),
    title: z.string().max(200).optional(),
  })
  .strict();

const objectGroupCommand: PptCommand<z.infer<typeof groupArgs>> = {
  id: "object.group",
  title: "组合多个对象",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: groupArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const slide = requireSlide(doc, args.slideId);
    if (slide.locked) throw new PptCommandError(`幻灯片已锁定: ${slide.id}`);
    const members = args.objectIds.map((id) => {
      const object = slide.objects.find((candidate) => candidate.id === id);
      if (!object) throw new PptCommandError(`幻灯片 "${slide.id}" 中不存在对象: ${id}`);
      assertObjectEditable(slide, id);
      return object;
    });
    // A member already inside another group would make the graph ambiguous.
    for (const existing of slide.objects) {
      if (existing.kind === "group" && existing.children.some((id) => args.objectIds.includes(id))) {
        throw new PptCommandError(`对象已在分组 ${existing.id} 中，请先取消原分组`);
      }
    }
    const union: Rect = {
      x: Math.min(...members.map((m) => m.rect.x)),
      y: Math.min(...members.map((m) => m.rect.y)),
      w: Math.max(...members.map((m) => m.rect.x + m.rect.w)) - Math.min(...members.map((m) => m.rect.x)),
      h: Math.max(...members.map((m) => m.rect.y + m.rect.h)) - Math.min(...members.map((m) => m.rect.y)),
    };
    const taken = new Set(slide.objects.map((o) => o.id));
    const id = args.id ?? uniqueId(`${slide.id}-group`, taken);
    assertUniqueId(taken, id, "对象");
    const shell: PptSlideObject = {
      id,
      kind: "group",
      rect: union,
      children: args.objectIds,
      ...(args.title ? { title: args.title } : {}),
    };
    const objects = [...slide.objects, shell];
    return {
      ...next(
        envelope,
        withSlide(doc, { ...slide, objects }),
        `已组合 ${members.length} 个对象为 ${id}`,
        [id, ...args.objectIds],
        objectScopeIds(slide.id, [id, ...args.objectIds]),
      ),
      createdIds: [id],
    };
  },
};

const ungroupArgs = z.object({ objectId: z.string().min(1).max(80) }).strict();

const objectUngroupCommand: PptCommand<z.infer<typeof ungroupArgs>> = {
  id: "object.ungroup",
  title: "取消组合",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: ungroupArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    if (object.kind !== "group") throw new PptCommandError(`对象 ${args.objectId} 不是分组`);
    const objects = slide.objects.filter((candidate) => candidate.id !== object.id);
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已取消分组 ${args.objectId}（成员保留）`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.duplicate (clone an object, or a group shell + its members)

const duplicateArgs = z.object({ objectId: z.string().min(1).max(80) }).strict();

function clampRectToCanvas(rect: Rect): Rect {
  const w = Math.min(rect.w, SLIDE_WIDTH);
  const h = Math.min(rect.h, SLIDE_HEIGHT);
  return {
    w,
    h,
    x: Math.max(0, Math.min(rect.x, SLIDE_WIDTH - w)),
    y: Math.max(0, Math.min(rect.y, SLIDE_HEIGHT - h)),
  };
}

// NOTE: execute is a legacy ~62-line linear function (group-clone vs single-
// clone branches, no deep nesting). Moved verbatim per behavior-preserving
// split; refactor is explicitly out of scope for this round.

const objectDuplicateCommand: PptCommand<z.infer<typeof duplicateArgs>> = {
  id: "object.duplicate",
  title: "复制对象",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: duplicateArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    const taken = new Set(slide.objects.map((o) => o.id));
    const offset = 24;
    let added: PptSlideObject[];
    let newId: string;
    if (object.kind === "group") {
      // Deep clone the members (a shell aliasing the same children would
      // corrupt group semantics), then create a new shell pointing at clones.
      const remap = new Map<string, string>();
      const cloneMembers: PptSlideObject[] = [];
      const walk = (groupId: string): string[] =>
        (slide.objects.find((o) => o.id === groupId) as Extract<PptSlideObject, { kind: "group" }> | undefined)?.children.map((childId) => {
          const child = slide.objects.find((o) => o.id === childId);
          if (!child) throw new PptCommandError(`分组成员 ${childId} 不存在`);
          const cloneId = uniqueId(`${slide.id}-${child.kind}`, new Set([...taken, ...remap.values()]));
          remap.set(childId, cloneId);
          const shifted: PptSlideObject =
            child.kind === "group"
              ? ({ ...child, id: cloneId, children: walk(childId) } as PptSlideObject)
              : ({
                  ...child,
                  id: cloneId,
                  rect: clampRectToCanvas({ ...child.rect, x: child.rect.x + offset, y: child.rect.y + offset }),
                } as PptSlideObject);
          delete (shifted as { locked?: boolean }).locked;
          cloneMembers.push(shifted);
          return cloneId;
        }) ?? [];
      newId = uniqueId(`${slide.id}-group`, new Set([...taken, ...cloneMembers.map((m) => m.id)]));
      const shell: PptSlideObject = {
        id: newId,
        kind: "group",
        rect: clampRectToCanvas({ ...object.rect, x: object.rect.x + offset, y: object.rect.y + offset }),
        children: walk(object.id),
        ...(object.title ? { title: object.title } : {}),
      };
      added = [...cloneMembers, shell];
    } else {
      newId = uniqueId(`${slide.id}-${object.kind}`, taken);
      const clone: PptSlideObject = {
        ...object,
        id: newId,
        rect: clampRectToCanvas({ ...object.rect, x: object.rect.x + offset, y: object.rect.y + offset }),
      } as PptSlideObject;
      delete (clone as { locked?: boolean }).locked;
      added = [clone];
    }
    const insertAt = slide.objects.findIndex((o) => o.id === object.id) + 1;
    const objects = [...slide.objects.slice(0, insertAt), ...added, ...slide.objects.slice(insertAt)];
    return {
      ...next(
        envelope,
        withSlide(doc, { ...slide, objects }),
        `已复制对象 ${args.objectId}`,
        [newId],
        objectScopeIds(slide.id, [newId]),
      ),
      createdIds: added.map((o) => o.id),
    };
  },
};

// ---------------------------------------------------------------------------
// object.reorder (z-order within the slide array: front/back/forward/backward)

const reorderArgs = z
  .object({
    objectId: z.string().min(1).max(80),
    position: z.enum(["front", "back", "forward", "backward"]),
  })
  .strict();

const objectReorderCommand: PptCommand<z.infer<typeof reorderArgs>> = {
  id: "object.reorder",
  title: "调整对象层级",
  riskLevel: "low",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: reorderArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    const from = slide.objects.findIndex((o) => o.id === object.id);
    let to = from;
    if (args.position === "front") to = slide.objects.length - 1;
    else if (args.position === "back") to = 0;
    else if (args.position === "forward") to = Math.min(from + 1, slide.objects.length - 1);
    else to = Math.max(from - 1, 0);
    if (to === from) {
      return next(envelope, doc, `对象已在${args.position === "front" || args.position === "forward" ? "最前" : "最后"}层`, [object.id], objectScopeIds(slide.id, [object.id]));
    }
    const objects = [...slide.objects];
    const [moved] = objects.splice(from, 1);
    objects.splice(to, 0, moved!);
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已调整对象 ${args.objectId} 的层级`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.remove

const removeArgs = z.object({ objectId: z.string().min(1).max(80) }).strict();

const objectRemoveCommand: PptCommand<z.infer<typeof removeArgs>> = {
  id: "object.remove",
  title: "删除幻灯片对象",
  riskLevel: "medium",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: removeArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    assertObjectEditable(slide, args.objectId);
    // Drop dangling group references so the deck stays checkPptDocument-clean.
    const objects = slide.objects
      .filter((candidate) => candidate.id !== args.objectId)
      .map((candidate) =>
        candidate.kind === "group" && candidate.children.includes(args.objectId)
          ? { ...candidate, children: candidate.children.filter((childId) => childId !== args.objectId) }
          : candidate,
      );
    return next(
      envelope,
      withSlide(doc, { ...slide, objects }),
      `已删除对象 ${args.objectId}`,
      [args.objectId],
      objectScopeIds(slide.id, [args.objectId]),
    );
  },
};

// ---------------------------------------------------------------------------
// object.lock

const lockArgs = z.object({ objectId: z.string().min(1).max(80), locked: z.boolean() }).strict();

const objectLockCommand: PptCommand<z.infer<typeof lockArgs>> = {
  id: "object.lock",
  title: "锁定或解锁对象",
  riskLevel: "medium",
  allowedScopeKinds: ["file", "container", "selection"],
  parameters: lockArgs,
  execute(envelope, args) {
    const doc = envelope.document;
    const { slide, object } = requireObjectInDeck(doc, args.objectId);
    const wasLocked = object.locked === true;
    const objects = slide.objects.map((candidate) =>
      candidate.id === args.objectId ? { ...candidate, locked: args.locked } : candidate,
    );
    return {
      ...next(
        envelope,
        withSlide(doc, { ...slide, objects }),
        args.locked ? `已锁定对象 ${args.objectId}` : `已解锁对象 ${args.objectId}`,
        [args.objectId],
        objectScopeIds(slide.id, [args.objectId]),
      ),
      ...(wasLocked && !args.locked ? { lockOverrideIds: [args.objectId] } : {}),
    };
  },
};

// Topology/lifecycle domain: object.add / object.group / object.ungroup /
// object.duplicate / object.reorder / object.remove / object.lock (registry
// slice order preserved).

export const OBJECT_TOPOLOGY_COMMANDS: CommandDefinition<PptDocument>[] = [
  objectAddCommand,
  objectGroupCommand,
  objectUngroupCommand,
  objectDuplicateCommand,
  objectReorderCommand,
  objectRemoveCommand,
  objectLockCommand,
];
