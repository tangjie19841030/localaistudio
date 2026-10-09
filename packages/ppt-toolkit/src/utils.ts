import type { DocumentEnvelope } from "@studio/studio-core";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type PptDocument, type PptSlide, type PptSlideObject, type Rect } from "./document.js";

export class PptCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptCommandError";
  }
}

/** Fixed-canvas guard shared by add/move/resize/align. */
export function assertRectInsideCanvas(rect: Rect, what: string): void {
  const inside =
    rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 &&
    rect.x + rect.w <= SLIDE_WIDTH + 1e-9 && rect.y + rect.h <= SLIDE_HEIGHT + 1e-9;
  if (!inside) {
    throw new PptCommandError(`${what} 超出固定画布范围（${SLIDE_WIDTH}x${SLIDE_HEIGHT}）或几何非法`);
  }
}

/** Collision-safe id generator against the taken set. */
export function uniqueId(seed: string, taken: ReadonlySet<string>): string {
  let n = 1;
  let candidate = `${seed}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${seed}-${n}`;
  }
  return candidate;
}

export type PptCommandEnvelope = DocumentEnvelope<PptDocument>;
export type { PptSlide, PptSlideObject };

export function assertUniqueId(taken: ReadonlySet<string>, id: string, kind: string): void {
  if (taken.has(id)) throw new PptCommandError(`${kind} ID 已存在: ${id}`);
}
