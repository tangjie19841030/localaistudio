import type { DocumentEnvelope, SelectionScope } from "@studio/studio-core";

/**
 * Scope self-healing across a long AI run.
 *
 * Scope targets are frozen at request time, but a toolkit run can legitimately
 * delete its own target: object.remove on the selected placeholder followed by
 * object.add of a replacement (live repro: the user selected the subtitle
 * placeholder; after it vanished the frozen scope still named
 * "slide-1-subtitle-1", so EVERY later command died in the adapter's
 * resolveScope with "PPT 选择目标不存在" — before the command body even ran.
 * The model cannot fix that by editing args, so it retried the same call until
 * its step budget was gone).
 *
 * Heal rule, applied against the CURRENT scratch envelope before each batch:
 *  - file: unchanged.
 *  - selection: targets that still exist stay; vanished targets widen the
 *    scope to their owning CONTAINER (slide / section). That owner was already
 *    part of the resolved reach — the adapters add the owning slide/section to
 *    allowedIds for every selection target — so healing never crosses the
 *    original reach promise, it only survives the target's deletion.
 *  - container: vanished targets are dropped; if none remain, healing fails
 *    (the whole slide/section is gone — nothing legitimate to widen to).
 *
 * The owner index is snapshotted from the run's INITIAL envelope, so a target
 * can still be traced to its container after the target itself was deleted.
 */

export const SCOPE_VANISHED_MESSAGE =
  "本次修改的作用目标在生成过程中已被删除，无法继续该范围的操作。请重新选择幻灯片/对象（或不选目标、按整篇范围）后再发一次指令。";

interface DomainIndex {
  /** Containers that existed when the run started (unknown ids are NOT healed). */
  initialContainers: Set<string>;
  initialOwners: Map<string, string>;
  aliveContainers: (doc: unknown) => Set<string>;
  aliveMembers: (doc: unknown) => Set<string>;
  /** Find the owner of a still-existing member in the current doc. */
  currentOwner: (doc: unknown, memberId: string) => string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isStringId(value: unknown): value is string {
  return typeof value === "string";
}

function pptIndex(initial: unknown): DomainIndex {
  const initialContainers = new Set<string>();
  const initialOwners = new Map<string, string>();
  for (const rawSlide of asArray(asRecord(initial).slides)) {
    const slide = asRecord(rawSlide);
    if (!isStringId(slide.id)) continue;
    initialContainers.add(slide.id);
    for (const rawObject of asArray(slide.objects)) {
      const object = asRecord(rawObject);
      if (isStringId(object.id)) initialOwners.set(object.id, slide.id);
    }
  }
  const slidesOf = (doc: unknown) => asArray(asRecord(doc).slides).map(asRecord);
  return {
    initialOwners,
    aliveContainers: (doc) => new Set(slidesOf(doc).map((slide) => slide.id).filter(isStringId)),
    aliveMembers: (doc) => {
      const ids = new Set<string>();
      for (const slide of slidesOf(doc)) {
        for (const object of asArray(slide.objects).map(asRecord)) {
          if (isStringId(object.id)) ids.add(object.id);
        }
      }
      return ids;
    },
    currentOwner: (doc, memberId) =>
      slidesOf(doc).find((slide) => asArray(slide.objects).some((raw) => asRecord(raw).id === memberId))?.id as
        | string
        | undefined,
    initialContainers,
  };
}

function wordIndex(initial: unknown): DomainIndex {
  const initialContainers = new Set<string>();
  const initialOwners = new Map<string, string>();
  for (const rawSection of asArray(asRecord(initial).sections)) {
    const section = asRecord(rawSection);
    if (!isStringId(section.id)) continue;
    initialContainers.add(section.id);
    for (const blockId of asArray(section.blockIds)) {
      if (isStringId(blockId)) initialOwners.set(blockId, section.id);
    }
  }
  const sectionsOf = (doc: unknown) => asArray(asRecord(doc).sections).map(asRecord);
  return {
    initialOwners,
    aliveContainers: (doc) => new Set(sectionsOf(doc).map((section) => section.id).filter(isStringId)),
    aliveMembers: (doc) =>
      new Set(asArray(asRecord(doc).blocks).map(asRecord).map((block) => block.id).filter(isStringId)),
    currentOwner: (doc, memberId) =>
      sectionsOf(doc).find((section) => asArray(section.blockIds).includes(memberId))?.id as string | undefined,
    initialContainers,
  };
}

/**
 * Re-derive one scope against the current doc. Returns null when every target
 * vanished with no owner to fall back to — the caller must ABORT instead of
 * feeding the adapter error to the model (no args change can recover it).
 */
export function healScope(doc: unknown, scope: SelectionScope, domain: DomainIndex): SelectionScope | null {
  if (scope.kind === "file") return scope;
  const containers = domain.aliveContainers(doc);
  if (scope.kind === "container") {
    // Ids absent at run start (stale/unknown client targets) are left intact —
    // the adapter keeps rejecting them with its own error; healing only acts on
    // targets the run itself deleted.
    if (!scope.targetIds.some((id) => domain.initialContainers.has(id))) return scope;
    const alive = scope.targetIds.filter((id) => containers.has(id));
    return alive.length > 0 ? { kind: "container", targetIds: alive } : null;
  }
  const members = domain.aliveMembers(doc);
  if (scope.targetIds.every((id) => members.has(id))) return scope;
  if (!scope.targetIds.some((id) => members.has(id) || domain.initialOwners.has(id))) {
    return scope; // all targets unknown at run start — adapter owns the error
  }
  // Some known member vanished: widen the scope to the owning containers (a ppt
  // selection scope cannot mix member ids with the slide id — the adapter
  // rejects that — so widen the whole scope; unknown ids drop out).
  const owners = new Set<string>();
  for (const id of scope.targetIds) {
    const owner = domain.currentOwner(doc, id) ?? domain.initialOwners.get(id);
    if (owner && containers.has(owner)) owners.add(owner);
  }
  return owners.size > 0 ? { kind: "container", targetIds: [...owners] } : null;
}

export interface ScopeHealer {
  /** Current effective scope for the given scratch envelope (monotonic). */
  heal(envelope: DocumentEnvelope): SelectionScope | null;
}

export function createScopeHealer(
  projectType: "ppt" | "word",
  initialEnvelope: DocumentEnvelope,
  baseScope: SelectionScope,
): ScopeHealer {
  const domain: DomainIndex =
    projectType === "ppt" ? pptIndex(initialEnvelope.document) : wordIndex(initialEnvelope.document);
  let current = baseScope;
  return {
    heal(envelope) {
      if (current.kind === "file") return current;
      const healed = healScope(envelope.document, current, domain);
      if (healed) current = healed;
      return healed;
    },
  };
}
