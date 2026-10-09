import { z } from "zod";

export const SELECTION_SCOPE_KINDS = ["file", "container", "selection", "range"] as const;
export type SelectionScopeKind = (typeof SELECTION_SCOPE_KINDS)[number];

export interface TextRange {
  containerId: string;
  start: number;
  end: number;
}

export interface SelectionScope {
  kind: SelectionScopeKind;
  targetIds: string[];
  range?: TextRange;
}

export interface ScopeResolution {
  allowAll: boolean;
  allowedIds: string[];
  /** IDs currently protected by direct or inherited locks. */
  lockedIds: string[];
  /** IDs with a direct lock eligible for a manual command's explicit override. */
  lockManagementIds: string[];
}

const textRangeSchema = z
  .object({
    containerId: z.string().min(1),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .strict()
  .refine((range) => range.end >= range.start, "文本范围 end 必须大于或等于 start");

export const selectionScopeSchema = z
  .object({
    kind: z.enum(SELECTION_SCOPE_KINDS),
    targetIds: z.array(z.string().min(1)).max(500),
    range: textRangeSchema.optional(),
  })
  .strict()
  .superRefine((scope, ctx) => {
    if (scope.kind === "file" && scope.targetIds.length !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "文件范围不能携带目标对象", path: ["targetIds"] });
    }
    if (scope.kind === "range" && !scope.range) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "文本范围必须提供 range", path: ["range"] });
    }
    if (scope.kind !== "range" && scope.range) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "只有文本范围可提供 range", path: ["range"] });
    }
  });

export class SelectionScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionScopeError";
  }
}

export function parseSelectionScope(input: unknown): SelectionScope {
  const parsed = selectionScopeSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new SelectionScopeError(`选择范围无效: ${details.join("; ")}`);
  }
  return parsed.data;
}

export function ensureScopeAllows(resolution: ScopeResolution, ids: readonly string[]): void {
  const blockedByLock = ids.filter((id) => resolution.lockedIds.includes(id));
  if (blockedByLock.length > 0) {
    throw new SelectionScopeError(`目标已锁定: ${blockedByLock.join("、")}`);
  }
  if (!resolution.allowAll) {
    const outside = ids.filter((id) => !resolution.allowedIds.includes(id));
    if (outside.length > 0) {
      throw new SelectionScopeError(`命令超出当前范围: ${outside.join("、")}`);
    }
  }
}
